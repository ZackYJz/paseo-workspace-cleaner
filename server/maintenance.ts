import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { listAllAgents, deletePaseoAgent, toPiSessionCandidate, removePiSession } from "./cleanup";
import { catalogRpc, maintenanceJob, previewRpc, projectRecord, startMaintenanceRpc, workspaceRecord, terminalJob, SUPPORTED_PASEO_MINOR, type MaintenanceJob, type WorkspaceRecord } from "../shared/maintenance";

type Api = PluginHandlerContext["paseo"];
const exec = promisify(execFile);
export const cleanerHome = () => path.resolve(process.env.PASEO_HOME || path.join(homedir(), ".paseo"));
export const jobRoot = (home: string) => path.join(home, "workspace-cleaner");
const registryPath = (home: string) => path.join(home, "projects", "workspaces.json");
const lockPath = (home: string) => path.join(jobRoot(home), "maintenance.lock");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
export const cliPath = () => process.env.PASEO_CLI_PATH || process.env.PASEO_CLI || "paseo";

export async function readRegular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`拒绝非普通文件：${file}`);
  return readFile(file, "utf8");
}
export async function atomicJson(file: string, value: unknown, beforeCommit?: () => Promise<void>) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
  await beforeCommit?.();
  await rename(temp, file);
}
export async function catalog(home = cleanerHome()) {
  const [workspaces, projects] = await Promise.all([
    readRegular(registryPath(home)).then(raw => z.array(workspaceRecord).parse(JSON.parse(raw))),
    readRegular(path.join(home, "projects", "projects.json")).then(raw => z.array(projectRecord).parse(JSON.parse(raw))),
  ]);
  if (new Set(workspaces.map(w => w.workspaceId)).size !== workspaces.length) throw new Error("Workspace 注册表有重复 ID，拒绝清理");
  return { workspaces, projects };
}
export async function latestJob(home = cleanerHome()) {
  try {
    const job = maintenanceJob.parse(JSON.parse(await readRegular(path.join(jobRoot(home), "latest.json"))));
    if (!terminalJob(job) && job.workerPid) {
      try { process.kill(job.workerPid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        job.phase = "needs-recovery"; job.detail = "维护进程已退出，但没有完成记录。已保留任务锁，请检查备份目录及 daemon 状态。";
      }
    }
    return job;
  }
  catch (error) { if (missing(error)) return null; throw error; }
}
export async function assertNoMaintenance(home = cleanerHome()) {
  try { await lstat(lockPath(home)); }
  catch (error) { if (missing(error)) return; throw error; }
  throw new Error("停机清理正在进行，或上次清理异常中断；请先查看任务结果，勿重复删除。");
}
export async function withCleanupLock<T>(action: () => Promise<T>, home = cleanerHome()): Promise<T> {
  await mkdir(jobRoot(home), { recursive: true, mode: 0o700 });
  const handle = await open(lockPath(home), "wx", 0o600).catch(() => { throw new Error("已有清理任务在执行，请等待完成后再操作"); });
  try { await handle.writeFile(`online:${process.pid}`); return await action(); }
  finally { await handle.close(); await unlink(lockPath(home)); }
}
export async function readCatalog(_input: RpcInput<typeof catalogRpc>, { paseo }: PluginHandlerContext) {
  const agents = await listAllAgents(paseo);
  const archivedAgents = agents.filter(a => a.archivedAt && a.status === "closed").map(a => ({
    id: a.id, title: a.title, provider: a.provider, cwd: a.cwd, workspaceId: a.workspaceId, status: "closed" as const, archivedAt: a.archivedAt!,
    updatedAt: a.updatedAt, createdAt: a.createdAt,
  }));
  return { ...await catalog(), job: await latestJob(), archivedAgents };
}

export function busyAgentNames(agents: Awaited<ReturnType<typeof listAllAgents>>) {
  return agents.filter(a => !["idle", "closed", "error"].includes(a.status) || a.activeTurn != null ||
    a.pendingPermissions.length > 0 || a.attentionReason === "permission").map(a => a.title || a.id);
}
async function jsonFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`拒绝非普通存储目录：${directory}`);
    entries = await readdir(directory, { withFileTypes: true });
  }
  catch (error) { if (missing(error)) return []; throw error; }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`存储目录含符号链接：${entry.name}`);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(file));
    else if (entry.name.endsWith(".json")) files.push(file);
  }
  return files;
}
export async function storedAgents(home: string) {
  return Promise.all((await jsonFiles(path.join(home, "agents"))).map(async file => {
    const raw = await readRegular(file);
    const agent = z.object({ id: z.string(), workspaceId: z.string().optional() }).passthrough().parse(JSON.parse(raw));
    return { file, raw, agent };
  }));
}
export async function supplementArchivedAgents(agents: Awaited<ReturnType<Api["agents"]["list"]>>["entries"][number]["agent"][], home = cleanerHome()) {
  const ids = new Set(agents.map(a => a.id));
  const absent = (await storedAgents(home)).filter(a => !ids.has(a.agent.id));
  if (!absent.length) return agents;
  const config = z.object({ listen: z.string() }).parse(JSON.parse(await readRegular(path.join(home, "paseo.pid"))));
  if (!/^127\.0\.0\.1:\d+$/.test(config.listen)) throw new Error("无法安全检查遗漏的 Agent：不是本机 TCP daemon");
  for (const stored of absent) {
    const { stdout } = await exec(cliPath(), ["agent", "inspect", stored.agent.id, "--host", config.listen, "--json"], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    const inspected = z.object({ Id: z.string(), Status: z.literal("closed"), Archived: z.literal(true), Cwd: z.string(), PendingPermissions: z.array(z.unknown()).length(0) }).parse(JSON.parse(stdout));
    const archived = z.object({ id: z.string(), cwd: z.string(), provider: z.string(), archivedAt: z.string(), lastStatus: z.literal("closed"), title: z.string().nullable().optional() }).passthrough().parse(stored.agent);
    if (inspected.Id !== archived.id || inspected.Cwd !== archived.cwd) throw new Error("遗漏的 Agent 身份不匹配");
    // These are explicitly closed archived records, not guessed live state. Unknown states fail closed above.
    agents.push({ ...archived, title: archived.title ?? null, status: "closed", activeTurn: null, pendingPermissions: [] } as unknown as typeof agents[number]);
  }
  return agents;
}
export async function scheduleBlockers(home: string) {
  const files = await jsonFiles(path.join(home, "schedules"));
  const schedules = await Promise.all(files.map(async file => z.object({
    id: z.string(), status: z.enum(["active", "paused", "completed"]),
    runs: z.array(z.object({ status: z.string() })).optional(),
  }).parse(JSON.parse(await readRegular(file)))));
  return schedules.filter(s => s.status === "active" || s.runs?.some(r => r.status === "running"))
    .map(s => `定时任务 / heartbeat 尚未暂停：${s.id}`);
}
export async function daemonStatus(home: string) {
  const { stdout } = await exec(cliPath(), ["daemon", "status", "--home", home, "--json"], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  return z.object({ home: z.string(), listen: z.string(), pid: z.number().optional(), serverId: z.string().optional(),
    localDaemon: z.string(), connectedDaemon: z.string(), daemonVersion: z.string().optional(), desktopManaged: z.boolean().optional(),
  }).passthrough().parse(JSON.parse(stdout));
}
export type DaemonStatusSnapshot = Awaited<ReturnType<typeof daemonStatus>>;
// 停机删除的唯一闸门：列出全部不满足条件，不掩盖任何一项。
// 维护进程、预览与设置页诊断均复用此函数，避免规则分散。
export function daemonGateIssues(status: DaemonStatusSnapshot, home: string): string[] {
  const issues: string[] = [];
  if (path.resolve(status.home) !== home) issues.push(`daemon home 不是 ${home}`);
  if (status.localDaemon !== "running") issues.push("本机 daemon 未运行");
  if (status.connectedDaemon !== "reachable") issues.push("daemon 连接不可达");
  if (!status.pid || !status.serverId) issues.push("缺少 daemon pid 或 serverId，无法确认身份");
  if (!status.daemonVersion?.startsWith(`${SUPPORTED_PASEO_MINOR}.`))
    issues.push(`Paseo ${status.daemonVersion ?? "版本未知"} 未经停机删除验证，仅支持 ${SUPPORTED_PASEO_MINOR}.x`);
  if (process.platform !== "darwin") issues.push(`仅支持 macOS，当前为 ${process.platform}`);
  if (!status.desktopManaged) issues.push("仅支持由 Paseo Desktop 管理的 daemon");
  if (!/^127\.0\.0\.1:\d+$/.test(status.listen)) issues.push(`监听地址 ${status.listen} 不是本机 TCP`);
  return issues;
}
export function validateDaemon(status: DaemonStatusSnapshot, home: string) {
  const issues = daemonGateIssues(status, home);
  if (issues.length) throw new Error(`停机删除不可用：${issues.join("；")}`);
}
export async function makePreview(paseo: Api, home = cleanerHome()) {
  const [{ workspaces, projects }, agents, schedules, stored] = await Promise.all([catalog(home), listAllAgents(paseo), scheduleBlockers(home), storedAgents(home)]);
  const targets = workspaces.filter(w => w.archivedAt).sort((a,b) => a.workspaceId.localeCompare(b.workspaceId));
  const ids = targets.map(w => w.workspaceId).sort();
  const targetAgents = agents.filter(a => a.workspaceId && ids.includes(a.workspaceId));
  const blockers = [...schedules];
  const liveIds = new Set(agents.map(a => a.id));
  if (stored.some(a => !liveIds.has(a.agent.id))) blockers.push("存在未被 daemon 列表返回的 Agent 存储记录，无法确认全局空闲状态");
  if (!ids.length) blockers.push("没有已归档的 Workspace，无需停机");
  const busy = busyAgentNames(agents);
  if (busy.length) blockers.push(`daemon 上有运行中、初始化或等待交互的 Agent：${busy.join("、")}`);
  const agentIds = targetAgents.map(a => a.id).sort();
  const token = createHash("sha256").update(JSON.stringify({ targets,
    agents: targetAgents.map(a => ({ id: a.id, workspaceId: a.workspaceId, archivedAt: a.archivedAt, cwd: a.cwd, provider: a.provider, updatedAt: a.updatedAt, persistence: a.persistence })).sort((a,b) => a.id.localeCompare(b.id)),
  })).digest("hex");
  const piHandles = targetAgents.filter(a => a.provider === "pi" && a.persistence?.nativeHandle && a.persistence.sessionId).map(a => a.persistence!.nativeHandle);
  return { token, workspaceIds: ids, agentIds, blockers, unarchivedAgentCount: targetAgents.filter(a => !a.archivedAt).length,
    piSessionCount: new Set(piHandles).size,
    workspaces: targets.map(w => {
      const project = projects.find(p => p.projectId === w.projectId);
      return { workspaceId: w.workspaceId, name: w.title || w.displayName, cwd: w.cwd,
        projectName: project?.customName || project?.displayName || w.projectId,
        agentCount: targetAgents.filter(a => a.workspaceId === w.workspaceId).length };
    }),
  };
}
export async function previewMaintenance(_input: RpcInput<typeof previewRpc>, { paseo }: PluginHandlerContext) {
  const result = await makePreview(paseo);
  try { await assertNoMaintenance(); validateDaemon(await daemonStatus(cleanerHome()), cleanerHome()); }
  catch (error) { result.blockers.push(errorText(error)); }
  return result;
}

export interface MaintenanceRequest { workspaceIds: string[]; token: string; }
export async function startMaintenance(input: RpcInput<typeof startMaintenanceRpc>, { paseo }: PluginHandlerContext) {
  const home = cleanerHome();
  const preview = await previewMaintenance({}, { paseo });
  if (preview.blockers.length) throw new Error(preview.blockers.join("\n"));
  if (preview.token !== input.token) throw new Error("删除范围已变化，请重新打开确认窗口");
  const { config } = await paseo.config.get();
  const plugin = config.plugins?.["paseo-workspace-cleaner"];
  if (!plugin || plugin.source !== "directory") throw new Error("停机清理需要本地目录安装的插件");
  const worker = path.join(plugin.path, "dist", "maintenance.mjs");
  await readRegular(worker);
  await mkdir(jobRoot(home), { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const lock = await open(lockPath(home), "wx", 0o600).catch(() => { throw new Error("已有停机任务，请勿重复执行"); });
  let launched = false;
  try {
    await lock.writeFile(id);
    const directory = path.join(jobRoot(home), id);
    await mkdir(directory, { mode: 0o700 });
    const job: MaintenanceJob = { id, phase: "queued", detail: "任务已提交，等待独立维护进程检查；尚未删除", updatedAt: new Date().toISOString(),
      backupDirectory: directory, deletedAgentIds: [], deletedWorkspaceIds: [], warnings: [] };
    await atomicJson(path.join(directory, "request.json"), { token: preview.token, workspaceIds: preview.workspaceIds, home });
    await saveJob(job, home);
    const child = spawn(process.execPath, [worker, directory], { detached: true, stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PASEO_HOME: home } });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref(); launched = true;
    job.workerPid = child.pid; await saveJob(job, home);
    return job;
  } finally { await lock.close(); if (!launched) await unlink(lockPath(home)); }
}
export async function saveJob(job: MaintenanceJob, home: string) {
  job.updatedAt = new Date().toISOString();
  await atomicJson(path.join(job.backupDirectory, "result.json"), job);
  await atomicJson(path.join(jobRoot(home), "latest.json"), job);
}

// Inject lifecycle boundaries so tests exercise the complete destructive workflow on fixtures only.
export interface MaintenanceLifecycle {
  check(): Promise<void>;
  stop(): Promise<void>;
  assertStopped(): Promise<void>;
  restart(): Promise<void>;
  verifyRestart(): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}
export async function runMaintenance(request: MaintenanceRequest, job: MaintenanceJob, paseo: Api, lifecycle: MaintenanceLifecycle, home: string) {
  let stopAttempted = false;
  const update = async (phase: MaintenanceJob["phase"], detail: string) => { job.phase = phase; job.detail = detail; await saveJob(job, home); };
  try {
    await update("checking", "重新检查全部 Agent、定时任务和删除范围");
    await lifecycle.check();
    const preview = await makePreview(paseo, home);
    if (preview.blockers.length) throw new Error(preview.blockers.join("\n"));
    if (preview.token !== request.token) throw new Error("删除范围已变化，任务已取消");
    if (JSON.stringify(preview.workspaceIds) !== JSON.stringify([...request.workspaceIds].sort())) throw new Error("任务不是完整的归档 Workspace 清单，已取消");
    const before = await catalog(home);
    const targets = before.workspaces.filter(w => request.workspaceIds.includes(w.workspaceId));
    const agents = await listAllAgents(paseo);
    const selected = agents.filter(a => preview.agentIds.includes(a.id));
    await writeFile(path.join(job.backupDirectory, "workspaces.before.json"), await readRegular(registryPath(home)), { flag: "wx", mode: 0o600 });
    await atomicJson(path.join(job.backupDirectory, "agents.before.json"), (await storedAgents(home)).filter(a => preview.agentIds.includes(a.agent.id)));
    await update("deleting-agents", "通过 Paseo 官方命令删除目标 Agent 与时间线");
    for (const agent of selected) {
      await lifecycle.check();
      assertUnchangedTargets((await catalog(home)).workspaces, targets);
      const current = await listAllAgents(paseo);
      if (busyAgentNames(current).length) throw new Error("检查后出现活动 Agent，已中止后续删除");
      const latest = current.find(a => a.id === agent.id);
      if (!latest || latest.workspaceId !== agent.workspaceId || latest.updatedAt !== agent.updatedAt || JSON.stringify(latest.persistence) !== JSON.stringify(agent.persistence)) throw new Error("目标 Agent 状态已变化，已中止");
      await lifecycle.deleteAgent(agent.id);
      if ((await listAllAgents(paseo)).some(a => a.id === agent.id) || (await storedAgents(home)).some(a => a.agent.id === agent.id))
        throw new Error(`Agent 删除未落实：${agent.id}`);
      job.deletedAgentIds.push(agent.id); await saveJob(job, home);
    }
    const lastCheck = await makePreview(paseo, home);
    if (lastCheck.blockers.length || lastCheck.agentIds.length) throw new Error("停机前检测到新增 Agent 或活动任务，已中止");
    if (JSON.stringify(lastCheck.workspaceIds) !== JSON.stringify(preview.workspaceIds)) throw new Error("归档 Workspace 清单已变化，请重新确认");
    await lifecycle.check();
    await update("stopping", "正在停止 daemon，客户端将暂时断开");
    stopAttempted = true;
    await lifecycle.stop();
    await lifecycle.assertStopped();
    await update("purging", "daemon 已停止，备份并移除 Workspace 归档记录");
    const remaining = await storedAgents(home);
    if (remaining.some(a => a.agent.workspaceId && request.workspaceIds.includes(a.agent.workspaceId))) throw new Error("仍有 Agent 引用目标 Workspace，保留记录");
    const raw = await readRegular(registryPath(home));
    const records = z.array(workspaceRecord).parse(JSON.parse(raw));
    assertUnchangedTargets(records, targets);
    if (JSON.stringify(records.filter(w => w.archivedAt).map(w => w.workspaceId).sort()) !== JSON.stringify(preview.workspaceIds)) throw new Error("停机后归档清单发生变化，保留原文件");
    await writeFile(path.join(job.backupDirectory, "workspaces.stopped.json"), raw, { flag: "wx", mode: 0o600 });
    await lifecycle.assertStopped();
    await atomicJson(registryPath(home), records.filter(w => !request.workspaceIds.includes(w.workspaceId)), async () => {
      await lifecycle.assertStopped();
      if (await readRegular(registryPath(home)) !== raw) throw new Error("提交前注册表发生变化，拒绝覆盖");
    });
    job.deletedWorkspaceIds = [...request.workspaceIds]; await saveJob(job, home);
    // Session removal happens offline, after rereading all remaining Agent references.
    for (const agent of selected) {
      await lifecycle.assertStopped();
      const result = await removePiSession(toPiSessionCandidate(agent), remaining.map(a => a.agent) as unknown as typeof agents, new Set(), true);
      if (result.detail) job.warnings.push(`${agent.id}: ${result.detail}`);
      await saveJob(job, home);
    }
  } catch (error) {
    job.phase = "failed"; job.detail = errorText(error); await saveJob(job, home);
  } finally {
    if (stopAttempted) {
      const failure = job.phase === "failed" ? job.detail : null;
      job.phase = "restarting"; job.detail = "正在恢复 daemon 并验证连接";
      try { await saveJob(job, home); }
      catch (error) { job.warnings.push(`无法记录恢复进度：${errorText(error)}`); }
      try {
        await lifecycle.restart(); await lifecycle.verifyRestart();
        const retained = (await catalog(home)).workspaces;
        if (job.deletedWorkspaceIds.some(id => retained.some(w => w.workspaceId === id))) throw new Error("重启后 Workspace 记录重新出现，需要人工检查");
        job.phase = failure ? "failed" : "completed";
        job.detail = failure ? `${failure}；daemon 已恢复` : "Workspace 记录已删除，daemon 已恢复";
      } catch (error) { job.phase = "needs-recovery"; job.detail = `${failure ? `${failure}；` : ""}恢复未确认：${errorText(error)}。请查看备份目录并手动检查 / 启动 daemon`; }
    }
    await saveJob(job, home);
    // Keep the lock on uncertain recovery; never allow another destructive job to hide it.
    if (terminalJob(job) && job.phase !== "needs-recovery") await unlink(lockPath(home));
  }
  return job;
}
export function assertUnchangedTargets(records: WorkspaceRecord[], targets: WorkspaceRecord[]) {
  for (const target of targets) {
    const current = records.find(w => w.workspaceId === target.workspaceId);
    if (!current?.archivedAt || JSON.stringify(current) !== JSON.stringify(target)) throw new Error("Workspace 注册记录已变化，保留原文件");
  }
}

export { deletePaseoAgent };

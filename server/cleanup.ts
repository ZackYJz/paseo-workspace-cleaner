import { execFile } from "node:child_process";
import { lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { catalogRpc } from "../shared/catalog";
import { cleanupAgentRpc, cleanupAgentsRpc, cleanupWorkspaceRpc, isFinishedAgent } from "../shared/cleanup";
import { catalog, supplementArchivedAgents, type AgentSnapshot } from "./registry";

const execFileAsync = promisify(execFile);
const PAGE_SIZE = 200;
const SESSION_HEADER_BYTES = 64 * 1024;

type PaseoApi = PluginHandlerContext["paseo"];
type PiSessionStatus = RpcOutput<typeof cleanupAgentRpc>["piSessions"][number];

export interface PiSessionCandidate {
  agentId: string;
  cwd: string;
  provider: string;
  sessionId: string | null;
  nativeHandle: string | null;
}

export async function listAllAgents(paseo: PaseoApi): Promise<AgentSnapshot[]> {
  const agents: AgentSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return supplementArchivedAgents(agents);
}

async function listAllActiveWorkspaces(paseo: PaseoApi) {
  const workspaces: Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({
      page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    });
    workspaces.push(...page.entries);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return workspaces;
}

export function toPiSessionCandidate(agent: AgentSnapshot): PiSessionCandidate {
  return {
    agentId: agent.id,
    cwd: agent.cwd,
    provider: agent.provider,
    sessionId: agent.persistence?.sessionId ?? agent.runtimeInfo?.sessionId ?? null,
    nativeHandle: agent.persistence?.nativeHandle ?? null,
  };
}

export async function deletePaseoAgent(agentId: string, host?: string): Promise<void> {
  const executable = process.env.PASEO_CLI_PATH?.trim() || process.env.PASEO_CLI || "paseo";
  try {
    const { stdout } = await execFileAsync(executable, ["agent", "delete", agentId, "--json", ...(host ? ["--host", host] : [])], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });
    const result = JSON.parse(stdout) as { deletedCount?: number; agentIds?: string[] };
    if (result.deletedCount !== 1 || result.agentIds?.length !== 1 || result.agentIds[0] !== agentId) {
      throw new Error("官方命令没有确认删除该 Agent");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Paseo Agent 删除失败：${message}`);
  }
}

async function readSessionHeader(filePath: string): Promise<Record<string, unknown>> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/u, 1)[0];
    const parsed: unknown = JSON.parse(firstLine ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("首行不是 Pi session 对象");
    }
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

export async function validatePiSessionFile(candidate: PiSessionCandidate): Promise<void> {
  if (candidate.provider !== "pi") throw new Error("Agent 不是 Pi provider");
  if (!candidate.sessionId || !candidate.nativeHandle) throw new Error("Agent 没有 Pi session 句柄");
  if (!path.isAbsolute(candidate.nativeHandle)) throw new Error("Pi session 路径不是绝对路径");
  if (path.extname(candidate.nativeHandle) !== ".jsonl") throw new Error("Pi session 不是 JSONL 文件");

  const stats = await lstat(candidate.nativeHandle);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Pi session 不是普通文件");

  const header = await readSessionHeader(candidate.nativeHandle);
  if (header.type !== "session" || header.id !== candidate.sessionId) {
    throw new Error("Pi session 文件头与 Paseo sessionId 不匹配");
  }
  if (typeof header.cwd !== "string" || path.resolve(header.cwd) !== path.resolve(candidate.cwd)) {
    throw new Error("Pi session 文件头与 Agent 工作目录不匹配");
  }
}

async function moveToTrash(filePath: string): Promise<"trashed" | "quarantined"> {
  const trashCommands: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["/usr/bin/trash", [filePath]]]
      : process.platform === "linux"
        ? [["gio", ["trash", filePath]], ["trash-put", [filePath]]]
        : [];

  for (const [command, args] of trashCommands) {
    try {
      await execFileAsync(command, args, { encoding: "utf8", timeout: 15_000 });
      return "trashed";
    } catch {
      // Try the next recoverable method.
    }
  }

  await rename(filePath, `${filePath}.paseo-trash-${Date.now()}`);
  return "quarantined";
}

function isSessionShared(
  candidate: PiSessionCandidate,
  allAgents: readonly AgentSnapshot[],
  deletingAgentIds: ReadonlySet<string>,
): boolean {
  if (!candidate.nativeHandle) return false;
  return allAgents.some(
    (agent) =>
      !deletingAgentIds.has(agent.id) &&
      agent.provider === "pi" &&
      agent.persistence?.nativeHandle === candidate.nativeHandle,
  );
}

export async function removePiSession(
  candidate: PiSessionCandidate,
  allAgents: readonly AgentSnapshot[],
  deletingAgentIds: ReadonlySet<string>,
  enabled: boolean,
): Promise<PiSessionStatus> {
  const base = { agentId: candidate.agentId, sessionId: candidate.sessionId };
  if (!enabled) return { ...base, status: "skipped", detail: null };
  if (candidate.provider !== "pi") return { ...base, status: "not-pi", detail: null };
  if (!candidate.nativeHandle || !candidate.sessionId) {
    return { ...base, status: "not-found", detail: "Agent 没有持久化的 Pi session 句柄" };
  }
  if (isSessionShared(candidate, allAgents, deletingAgentIds)) {
    return { ...base, status: "shared", detail: "仍被其他 Paseo Agent 引用，已保留" };
  }

  try {
    await validatePiSessionFile(candidate);
    const status = await moveToTrash(candidate.nativeHandle);
    return { ...base, status, detail: status === "trashed" ? "已移入系统废纸篓" : "已改名隔离，可恢复" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
    if (code === "ENOENT") return { ...base, status: "not-found", detail: "Session 文件已不存在" };
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: "not-found", detail: `未移动 Session：${message}` };
  }
}

// 插件子进程里唯一的删除通道：所有清理按到达顺序排队，一次只跑一个，不交错执行。
// 进程内互斥即可，不再需要文件锁，进程崩溃也不会留下卡死的锁。
//
// 排队而不是直接拒绝：连续删几个 Workspace 时，上一个还在后台删 Agent，下一个请求就到了
// （浮层点外面就关，但服务端还在跑），直接拒绝会让用户莫名其妙地失败。
// 等待有上限：客户端插件 RPC 默认 60 秒超时，等太久客户端先报错、服务端过后却照删，
// 结果和提示对不上。所以最多等 CLEANUP_QUEUE_WAIT_MS，等不到就放弃这次请求，什么都不删。
export const CLEANUP_QUEUE_WAIT_MS = 40_000;
let queueTail: Promise<void> = Promise.resolve();
let cleanupRunning = false;
let cleanupWaiting = 0;
export function withCleanupLock<T>(action: () => Promise<T>, waitMs = CLEANUP_QUEUE_WAIT_MS): Promise<T> {
  const previous = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((resolve) => { release = resolve; });
  cleanupWaiting++;
  return new Promise<T>((resolve, reject) => {
    let abandoned = false;
    const timer = setTimeout(() => {
      abandoned = true;
      cleanupWaiting--;
      reject(new Error(`上一个清理任务还没完成（已等待 ${Math.round(waitMs / 1000)} 秒），这次没有删除任何内容，请稍后重试。`));
    }, waitMs);
    void previous.then(async () => {
      clearTimeout(timer);
      // 放弃了的请求也要按顺序交出位置，否则排在它后面的会一直等下去。
      if (abandoned) { release(); return; }
      cleanupWaiting--;
      cleanupRunning = true;
      try { resolve(await action()); }
      catch (error) { reject(error); }
      finally { cleanupRunning = false; release(); }
    });
  });
}
/** 有任务在跑或在排队。自动清理据此让路，不和手动清理抢位置。 */
export const cleanupBusy = () => cleanupRunning || cleanupWaiting > 0;

export async function deleteAgents(
  targets: readonly AgentSnapshot[],
  paseo: PaseoApi,
  deletePiSessions: boolean,
) {
  const deletedAgentIds: string[] = [];
  const piSessions: PiSessionStatus[] = [];
  const warnings: string[] = [];

  // 逐个调用官方删除命令，全部跑完后只读一次目录做核对。原先每删一个就读两遍完整目录
  // （每遍还可能为磁盘上的归档记录逐个起 `paseo agent inspect`），几个 Agent 就要好几秒，
  // 连续清理时很容易和下一个请求撞上。
  const confirmed: AgentSnapshot[] = [];
  for (const agent of targets) {
    try {
      await deletePaseoAgent(agent.id);
      confirmed.push(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${agent.title ?? agent.id}: ${message}`);
    }
  }
  if (confirmed.length === 0) return { deletedAgentIds, piSessions, warnings };

  // 核对和 Pi session 引用检查共用这一份删除后的目录，包括删除失败、仍然存在的 Agent。
  const remaining = await listAllAgents(paseo);
  const stillThere = new Set(remaining.map(a => a.id));
  for (const agent of confirmed) {
    if (stillThere.has(agent.id)) warnings.push(`${agent.title ?? agent.id}: Agent 删除后仍然存在`);
    else deletedAgentIds.push(agent.id);
  }
  for (const agent of confirmed.filter(a => deletedAgentIds.includes(a.id))) {
    piSessions.push(await removePiSession(toPiSessionCandidate(agent), remaining, new Set(), deletePiSessions));
  }
  return { deletedAgentIds, piSessions, warnings };
}

// 目标选择是纯函数：全量模式取 Workspace 下全部 Agent，
// 已结束模式只取已归档或已关闭的，idle/running 永不入列。
export function selectCleanupTargets(
  allAgents: readonly AgentSnapshot[],
  workspaceId: string,
  onlyFinished: boolean,
): AgentSnapshot[] {
  const inWorkspace = allAgents.filter((agent) => agent.workspaceId === workspaceId);
  return onlyFinished ? inWorkspace.filter((agent) => isFinishedAgent(agent)) : inWorkspace;
}

export async function cleanupAgent(
  input: RpcInput<typeof cleanupAgentRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof cleanupAgentRpc>> {
  return withCleanupLock(async () => {
    const allAgents = await listAllAgents(paseo);
    const agent = allAgents.find((candidate) => candidate.id === input.agentId);
    if (!agent) throw new Error(`找不到 Agent：${input.agentId}`);
    const result = await deleteAgents([agent], paseo, input.deletePiSession);
    if (result.deletedAgentIds.length === 0) {
      throw new Error(result.warnings[0] ?? `Agent 删除失败：${input.agentId}`);
    }
    return result;
  });
}

export async function cleanupAgents(
  input: RpcInput<typeof cleanupAgentsRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof cleanupAgentsRpc>> {
  return withCleanupLock(async () => {
    const allAgents = await listAllAgents(paseo);
    const wanted = new Set(input.agentIds);
    const targets = allAgents.filter((agent) => wanted.has(agent.id));
    const missing = input.agentIds.filter((id) => !targets.some((agent) => agent.id === id));
    const result = await deleteAgents(targets, paseo, input.deletePiSessions);
    result.warnings.push(...missing.map((id) => `${id}: 找不到这个 Agent，可能已被删除`));
    if (result.deletedAgentIds.length === 0) throw new Error(result.warnings[0] ?? "没有删除任何 Agent");
    return result;
  });
}

export async function cleanupWorkspace(
  input: RpcInput<typeof cleanupWorkspaceRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof cleanupWorkspaceRpc>> {
  return withCleanupLock(async () => {
    const [allAgents, activeWorkspaces] = await Promise.all([
      listAllAgents(paseo),
      listAllActiveWorkspaces(paseo),
    ]);
    const activeWorkspace = activeWorkspaces.find((workspace) => workspace.id === input.workspaceId);
    // 已结束模式不归档 Workspace，也不需要 worktree 的原生归档前置检查。
    if (activeWorkspace?.workspaceKind === "worktree" && !input.onlyFinished) {
      throw new Error("活跃 worktree 必须先用 Paseo 原生 Archive 完成风险检查，再从 Cleaner 清理历史。");
    }

    let workspaceArchived = false;
    if (activeWorkspace && !input.onlyFinished) {
      const result = await paseo.workspaces.archive(input.workspaceId);
      if (result.error) throw new Error(`Workspace 归档失败：${result.error}`);
      workspaceArchived = Boolean(result.archivedAt);
    }

    const targets = selectCleanupTargets(allAgents, input.workspaceId, input.onlyFinished);
    const result = await deleteAgents(targets, paseo, input.deletePiSessions);
    if (targets.length === 0) {
      result.warnings.push(input.onlyFinished
        ? "这个 Workspace 下没有已归档或已关闭的 Agent。"
        : "这个 Workspace 下没有 Agent。");
    }
    return { workspaceArchived, ...result };
  });
}

export async function readCatalog(_input: RpcInput<typeof catalogRpc>, { paseo }: PluginHandlerContext) {
  const agents = await listAllAgents(paseo);
  const archivedAgents = agents.filter(a => a.archivedAt && a.status === "closed").map(a => ({
    id: a.id, title: a.title, provider: a.provider, cwd: a.cwd, workspaceId: a.workspaceId, status: "closed" as const, archivedAt: a.archivedAt!,
    updatedAt: a.updatedAt, createdAt: a.createdAt,
  }));
  return { ...await catalog(), archivedAgents };
}

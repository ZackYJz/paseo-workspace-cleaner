import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { projectRecord, workspaceRecord } from "../shared/catalog";

// 只读访问 Paseo 的本地存储。Paseo 的 SDK 不列出已归档的 Workspace，也会漏掉部分已归档 Agent，
// 这里补齐清理页需要的视图；插件从不写这些文件，删除一律走官方 `paseo agent delete`。

type Api = PluginHandlerContext["paseo"];
export type AgentSnapshot = Awaited<ReturnType<Api["agents"]["list"]>>["entries"][number]["agent"];

const exec = promisify(execFile);
export const cleanerHome = () => path.resolve(process.env.PASEO_HOME || path.join(homedir(), ".paseo"));
export const cliPath = () => process.env.PASEO_CLI_PATH || process.env.PASEO_CLI || "paseo";
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

export async function readRegular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`拒绝非普通文件：${file}`);
  return readFile(file, "utf8");
}

export async function catalog(home = cleanerHome()) {
  const [workspaces, projects] = await Promise.all([
    readRegular(path.join(home, "projects", "workspaces.json")).then(raw => z.array(workspaceRecord).parse(JSON.parse(raw))),
    readRegular(path.join(home, "projects", "projects.json")).then(raw => z.array(projectRecord).parse(JSON.parse(raw))),
  ]);
  if (new Set(workspaces.map(w => w.workspaceId)).size !== workspaces.length) throw new Error("Workspace 注册表有重复 ID，拒绝清理");
  return { workspaces, projects };
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

// 截至 0.11.2，agents.list({ includeArchived }) 仍会漏掉一部分已归档 Agent。
// 只补「存储里有、列表里没有」的记录，并逐个用官方 inspect 确认它确实已归档且已关闭。
export async function supplementArchivedAgents(agents: AgentSnapshot[], home = cleanerHome()) {
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
    agents.push({ ...archived, title: archived.title ?? null, status: "closed", activeTurn: null, pendingPermissions: [] } as unknown as AgentSnapshot);
  }
  return agents;
}

export function isBusyAgent(agent: AgentSnapshot): boolean {
  return !["idle", "closed", "error"].includes(agent.status) || agent.activeTurn != null ||
    agent.pendingPermissions.length > 0 || agent.attentionReason === "permission";
}

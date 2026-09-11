import { mkdtemp, mkdir, readFile, writeFile, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { makePreview, runMaintenance, catalog, daemonGateIssues, scheduleBlockers, type MaintenanceLifecycle, type MaintenanceRequest } from "./maintenance";
import type { MaintenanceJob } from "../shared/maintenance";
import { previewRpc, startMaintenanceRpc } from "../shared/maintenance";

let home: string;
const workspace = { workspaceId: "w1", projectId: "p1", cwd: "/tmp/project", displayName: "已归档", archivedAt: "2026-09-01", unknownField: { preserve: true } };
const other = { ...workspace, workspaceId: "w2", projectId: "p2", archivedAt: null };
const agent = { id: "a1", workspaceId: "w1", cwd: "/tmp/project", provider: "pi", status: "closed", pendingPermissions: [], archivedAt: "2026-09-01", persistence: null, updatedAt: "2026-09-01" };
let agents: Array<Record<string, unknown>>;
let paseo: PluginHandlerContext["paseo"];
let lifecycle: MaintenanceLifecycle;
let job: MaintenanceJob;
let request: MaintenanceRequest;
const writeRegistry = (rows: unknown[]) => writeFile(path.join(home, "projects/workspaces.json"), JSON.stringify(rows));
const agentFile = () => path.join(home, "agents/by-cwd/a1.json");

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "paseo-maintenance-test-"));
  vi.stubEnv("PASEO_HOME", home);
  for (const directory of ["projects", "agents/by-cwd", "schedules", "workspace-cleaner/test-job"]) await mkdir(path.join(home, directory), { recursive: true });
  await writeRegistry([workspace, other]);
  await writeFile(path.join(home, "projects/projects.json"), JSON.stringify([{ projectId: "p1", rootPath: "/tmp/project", displayName: "Project" }]));
  await writeFile(agentFile(), JSON.stringify(agent));
  await writeFile(path.join(home, "workspace-cleaner/maintenance.lock"), "test-job");
  agents = [{ ...agent }];
  paseo = { agents: { list: vi.fn(async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: { nextCursor: null } })) } } as unknown as PluginHandlerContext["paseo"];
  lifecycle = {
    check: vi.fn(async () => {}), stop: vi.fn(async () => {}), assertStopped: vi.fn(async () => {}),
    restart: vi.fn(async () => {}), verifyRestart: vi.fn(async () => {}),
    deleteAgent: vi.fn(async id => { agents = agents.filter(a => a.id !== id); await unlink(agentFile()); }),
  };
  job = { id: "test-job", phase: "queued", detail: "", updatedAt: "", backupDirectory: path.join(home, "workspace-cleaner/test-job"), deletedAgentIds: [], deletedWorkspaceIds: [], warnings: [] };
  const preview = await makePreview(paseo, home);
  request = { workspaceIds: preview.workspaceIds, token: preview.token };
});
afterEach(() => vi.unstubAllEnvs());
const run = () => runMaintenance(request, job, paseo, lifecycle, home);

test("official Agent deletion precedes stop; backup, exact purge and recovery preserve unrelated rows", async () => {
  const result = await run();
  expect(result.phase).toBe("completed");
  expect(result.deletedAgentIds).toEqual(["a1"]);
  expect(result.deletedWorkspaceIds).toEqual(["w1"]);
  expect((await catalog(home)).workspaces).toEqual([other]);
  expect(JSON.parse(await readFile(path.join(job.backupDirectory, "workspaces.stopped.json"), "utf8"))).toEqual([workspace, other]);
  expect(vi.mocked(lifecycle.deleteAgent).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lifecycle.stop).mock.invocationCallOrder[0]!);
  expect(lifecycle.verifyRestart).toHaveBeenCalledOnce();
});
test.each(["running", "initializing", "unknown"])("blocks %s anywhere on daemon", async status => {
  agents.push({ ...agent, id: "unrelated", workspaceId: "w2", status });
  expect((await makePreview(paseo, home)).blockers.join()).toContain("Agent");
  expect((await run()).phase).toBe("failed");
  expect(lifecycle.deleteAgent).not.toHaveBeenCalled(); expect(lifecycle.stop).not.toHaveBeenCalled();
});
test("pending permissions and active turns block while finished attention alone does not", async () => {
  agents[0] = { ...agent, status: "idle", attentionReason: "finished" };
  expect((await makePreview(paseo, home)).blockers).toEqual([]);
  agents[0]!.pendingPermissions = [{}];
  expect((await makePreview(paseo, home)).blockers).not.toEqual([]);
  agents[0] = { ...agent, activeTurn: { id: "turn" } };
  expect((await makePreview(paseo, home)).blockers).not.toEqual([]);
});
test("includes idle unarchived Agent beneath archived workspace after explicit fresh confirmation", async () => {
  agents[0]!.archivedAt = null;
  const preview = await makePreview(paseo, home);
  expect(preview.unarchivedAgentCount).toBe(1);
  expect(preview.blockers).toEqual([]);
  request.token = preview.token;
  expect((await run()).phase).toBe("completed");
  expect(lifecycle.deleteAgent).toHaveBeenCalledWith("a1");
});
test("stale snapshot rejects before deleting", async () => {
  agents[0]!.updatedAt = "changed";
  expect((await run()).detail).toContain("范围已变化");
  expect(lifecycle.deleteAgent).not.toHaveBeenCalled();
});
test("enabled heartbeat or running schedule blocks and malformed files fail closed", async () => {
  const file = path.join(home, "schedules/heartbeat.json");
  await writeFile(file, JSON.stringify({ id: "heartbeat", status: "active", target: { type: "agent" }, runs: [] }));
  expect(await scheduleBlockers(home)).toHaveLength(1);
  await writeFile(file, "broken");
  expect((await run()).phase).toBe("failed");
  expect(lifecycle.stop).not.toHaveBeenCalled();
});
test("deletion acknowledgement without storage removal does not purge or stop", async () => {
  lifecycle.deleteAgent = vi.fn(async () => {});
  expect((await run()).detail).toContain("删除未落实");
  expect(lifecycle.stop).not.toHaveBeenCalled();
  expect((await catalog(home)).workspaces).toHaveLength(2);
});
test("failed stop never writes registry and still attempts recovery", async () => {
  lifecycle.stop = vi.fn(async () => { throw new Error("stop failed"); });
  expect((await run()).phase).toBe("failed");
  expect((await catalog(home)).workspaces).toHaveLength(2);
  expect(lifecycle.restart).toHaveBeenCalledOnce();
});
test("daemon respawn detected before write preserves registry", async () => {
  lifecycle.assertStopped = vi.fn(async () => { throw new Error("daemon restarted"); });
  expect((await run()).phase).toBe("failed");
  expect((await catalog(home)).workspaces).toHaveLength(2);
});
test("concurrent registry change aborts purge, while preserving changed data", async () => {
  lifecycle.stop = vi.fn(async () => { await writeRegistry([{ ...workspace, title: "changed" }, other]); });
  expect((await run()).detail).toContain("注册记录已变化");
  expect((await catalog(home)).workspaces[0]!.title).toBe("changed");
});
test("new stored Agent found after stop prevents orphaning", async () => {
  lifecycle.stop = vi.fn(async () => { await writeFile(agentFile(), JSON.stringify({ ...agent, id: "new" })); });
  expect((await run()).detail).toContain("仍有 Agent 引用");
  expect((await catalog(home)).workspaces).toHaveLength(2);
});
test("restart failure retains recovery lock and reports actual deleted objects", async () => {
  lifecycle.restart = vi.fn(async () => { throw new Error("start failed"); });
  const result = await run();
  expect(result.phase).toBe("needs-recovery");
  expect(result.deletedWorkspaceIds).toEqual(["w1"]);
  expect(await readFile(path.join(home, "workspace-cleaner/maintenance.lock"), "utf8")).toBe("test-job");
});
test("symlink registry is rejected without deleting Agents", async () => {
  await unlink(path.join(home, "projects/workspaces.json"));
  await writeFile(path.join(home, "original.json"), JSON.stringify([workspace, other]));
  await symlink(path.join(home, "original.json"), path.join(home, "projects/workspaces.json"));
  expect((await run()).phase).toBe("failed");
  expect(lifecycle.deleteAgent).not.toHaveBeenCalled();
});
test("shared Pi session survives workspace deletion", async () => {
  const session = path.join(home, "session.jsonl");
  await writeFile(session, JSON.stringify({ type: "session", id: "session", cwd: agent.cwd }) + "\n");
  agents[0]!.persistence = { sessionId: "session", nativeHandle: session };
  const shared = { ...agent, id: "a2", workspaceId: "w2", persistence: agents[0]!.persistence };
  agents.push(shared);
  await writeFile(path.join(home, "agents/by-cwd/a2.json"), JSON.stringify(shared));
  request.token = (await makePreview(paseo, home)).token;
  const result = await run();
  expect(result.phase).toBe("completed");
  expect(result.warnings.join()).toContain("仍被其他 Paseo Agent 引用");
  expect(await readFile(session, "utf8")).toContain("session");
});

test("bulk preview covers all archived workspaces including empty ones, not active same-cwd workspace", async () => {
  const empty = { ...workspace, workspaceId: "empty", projectId: "p2" };
  await writeRegistry([workspace, other, empty]);
  const preview = await makePreview(paseo, home);
  expect(preview.workspaceIds).toEqual(["empty", "w1"]);
  expect(preview.agentIds).toEqual(["a1"]);
  request = { workspaceIds: preview.workspaceIds, token: preview.token };
  const result = await run();
  expect(result.deletedWorkspaceIds).toEqual(["empty", "w1"]);
  expect((await catalog(home)).workspaces).toEqual([other]);
});
test("newly archived workspace invalidates confirmation without stopping or deleting", async () => {
  await writeRegistry([workspace, { ...other, archivedAt: "2026-09-02" }]);
  expect((await run()).detail).toContain("范围已变化");
  expect(lifecycle.deleteAgent).not.toHaveBeenCalled();
  expect(lifecycle.stop).not.toHaveBeenCalled();
});
test("empty archive set blocks maintenance", async () => {
  await writeRegistry([other]);
  expect((await makePreview(paseo, home)).blockers).toContain("没有已归档的 Workspace，无需停机");
});
test("a subset of archived workspaces cannot be substituted into the worker request", async () => {
  await writeRegistry([workspace, other, { ...workspace, workspaceId: "empty" }]);
  request.token = (await makePreview(paseo, home)).token;
  expect((await run()).detail).toContain("不是完整");
  expect(lifecycle.deleteAgent).not.toHaveBeenCalled();
});
test("archive set changes after Agent deletion abort before stopping", async () => {
  lifecycle.deleteAgent = vi.fn(async () => { agents = []; await unlink(agentFile()); await writeRegistry([workspace, { ...other, archivedAt: "2026-09-02" }]); });
  expect((await run()).detail).toContain("清单已变化");
  expect(lifecycle.stop).not.toHaveBeenCalled();
});
test("legacy partial-scope or session-opt-out RPC inputs are rejected", () => {
  expect(previewRpc.input.safeParse({ workspaceIds: ["w1"] }).success).toBe(false);
  expect(startMaintenanceRpc.input.safeParse({ token: "x", confirmation: "DELETE", workspaceIds: ["w1"] }).success).toBe(false);
  expect(startMaintenanceRpc.input.safeParse({ token: "x", confirmation: "DELETE", deletePiSessions: false }).success).toBe(false);
});
test("bulk cleanup includes the Pi session without an opt-in field", async () => {
  const session = path.join(home, "session.jsonl");
  await writeFile(session, JSON.stringify({ type: "session", id: "session", cwd: agent.cwd }) + "\n");
  agents[0]!.persistence = { sessionId: "session", nativeHandle: session };
  const preview = await makePreview(paseo, home);
  expect(preview.piSessionCount).toBe(1);
  request.token = preview.token;
  expect((await run()).phase).toBe("completed");
  await expect(readFile(session, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
test("停机版本闸门放行整个 0.8.x，拒绝其他版本线", () => {
  const versionIssues = (daemonVersion?: string) => daemonGateIssues({
    home, listen: "127.0.0.1:6767", pid: 4242, serverId: "srv_test",
    localDaemon: "running", connectedDaemon: "reachable", desktopManaged: true, daemonVersion,
  }, home).filter(issue => issue.includes("未经停机删除验证"));
  expect(versionIssues("0.8.0")).toEqual([]);
  expect(versionIssues("0.8.7")).toEqual([]);
  expect(versionIssues("0.8.0-beta.1")).toEqual([]);
  expect(versionIssues("0.7.2")).toHaveLength(1);
  expect(versionIssues("0.9.0")).toHaveLength(1);
  expect(versionIssues()).toHaveLength(1);
});

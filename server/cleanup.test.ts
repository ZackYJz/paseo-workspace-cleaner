import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { cleanupAgent, deletePaseoAgent, selectCleanupTargets, validatePiSessionFile } from "./cleanup";
import { isFinishedAgent } from "../shared/cleanup";

const cli = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", async importOriginal => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: (file: string, args: string[], options: unknown, callback: (error: Error | null, result?: unknown) => void) => {
    if (args[0] === "agent") { const result = cli.run(file, args) ?? { deletedCount: 1, agentIds: [args[2]] }; callback(null, { stdout: JSON.stringify(result), stderr: "" }); }
    else callback(new Error("Use recoverable rename in tests"));
  } };
});

test("已结束模式只选中已归档与已关闭，全量模式选中 Workspace 下全部", () => {
  const agents = [
    { id: "a1", workspaceId: "w1", status: "idle", archivedAt: null },
    { id: "a2", workspaceId: "w1", status: "closed", archivedAt: null },
    { id: "a3", workspaceId: "w1", status: "running", archivedAt: null },
    { id: "a4", workspaceId: "w1", status: "closed", archivedAt: "2026-09-01" },
    { id: "a5", workspaceId: "w2", status: "closed", archivedAt: null },
  ] as never;
  expect(selectCleanupTargets(agents, "w1", false).map((a: { id: string }) => a.id)).toEqual(["a1", "a2", "a3", "a4"]);
  expect(selectCleanupTargets(agents, "w1", true).map((a: { id: string }) => a.id)).toEqual(["a2", "a4"]);
  expect(isFinishedAgent({ status: "idle" })).toBe(false);
  expect(isFinishedAgent({ status: "running" })).toBe(false);
  expect(isFinishedAgent({ status: "closed" })).toBe(true);
  expect(isFinishedAgent({ archivedAt: "2026-09-01" })).toBe(true);
});

test("exit zero without exact deletion acknowledgement is rejected", async () => {
  cli.run.mockReturnValueOnce({ deletedCount: 0, agentIds: [] });
  await expect(deletePaseoAgent("exact-id")).rejects.toThrow("没有确认删除");
  cli.run.mockReturnValueOnce({ deletedCount: 1, agentIds: ["wrong-id"] });
  await expect(deletePaseoAgent("exact-id")).rejects.toThrow("没有确认删除");
});

async function makeSession(header: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-cleaner-"));
  const file = path.join(directory, `session_${String(header.id)}.jsonl`);
  await writeFile(file, `${JSON.stringify(header)}\n`, "utf8");
  return file;
}

describe("validatePiSessionFile", () => {
  test("accepts an exact Pi session handle", async () => {
    const cwd = "/tmp/example-project";
    const sessionId = "session-1";
    const nativeHandle = await makeSession({ type: "session", id: sessionId, cwd });
    await expect(
      validatePiSessionFile({ agentId: "agent-1", provider: "pi", cwd, sessionId, nativeHandle }),
    ).resolves.toBeUndefined();
    await expect(readFile(nativeHandle, "utf8")).resolves.toContain(sessionId);
  });

  test("rejects a mismatched session id", async () => {
    const nativeHandle = await makeSession({ type: "session", id: "other", cwd: "/tmp/project" });
    await expect(
      validatePiSessionFile({ agentId: "agent-1", provider: "pi", cwd: "/tmp/project", sessionId: "expected", nativeHandle }),
    ).rejects.toThrow("sessionId 不匹配");
  });

  test("rejects a mismatched working directory", async () => {
    const nativeHandle = await makeSession({ type: "session", id: "session-1", cwd: "/tmp/other" });
    await expect(
      validatePiSessionFile({ agentId: "agent-1", provider: "pi", cwd: "/tmp/project", sessionId: "session-1", nativeHandle }),
    ).rejects.toThrow("工作目录不匹配");
  });
});

test("cleanupAgent hard-deletes Paseo state before removing the Pi session", async () => {
  const cwd = "/tmp/example-project";
  const sessionId = "session-cleanup";
  const nativeHandle = await makeSession({ type: "session", id: sessionId, cwd });
  const agent = {
    id: "agent-cleanup",
    provider: "pi",
    cwd,
    workspaceId: "workspace-1",
    persistence: { provider: "pi", sessionId, nativeHandle },
    runtimeInfo: { provider: "pi", sessionId },
  };
  let deleted = false;
  cli.run.mockImplementation(() => { deleted = true; });
  const paseo = {
    agents: {
      list: async () => ({
        requestId: "test",
        entries: deleted ? [] : [{ agent, project: {} }],
        pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      }),
    },
  } as unknown as PluginHandlerContext["paseo"];
  const previousCliPath = process.env.PASEO_CLI_PATH;
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = path.dirname(nativeHandle);
  process.env.PASEO_CLI_PATH = "/usr/bin/true";

  try {
    const result = await cleanupAgent(
      { agentId: agent.id, deletePiSession: true, confirmation: "DELETE" },
      { paseo },
    );
    expect(result.deletedAgentIds).toEqual([agent.id]);
    expect(["trashed", "quarantined"]).toContain(result.piSessions[0]?.status);
    await expect(access(nativeHandle)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousCliPath === undefined) delete process.env.PASEO_CLI_PATH;
    else process.env.PASEO_CLI_PATH = previousCliPath;
  }
});

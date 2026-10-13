import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { cleanerSettings, type CleanerPreferences } from "../shared/settings";
import { AUTO_INTERVAL_MS, AutoCleaner, selectDue } from "./auto-cleanup";
import { withCleanupLock } from "./cleanup";
import type { AgentSnapshot } from "./registry";

const cli = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, result?: unknown) => void) => {
    if (args[0] === "agent" && args[1] === "delete") {
      cli.deleted.push(args[2]!);
      return callback(null, { stdout: JSON.stringify({ deletedCount: 1, agentIds: [args[2]] }), stderr: "" });
    }
    callback(new Error(`unexpected command ${args.join(" ")}`));
  },
}));

const NOW = Date.parse("2026-10-13T00:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const ws = (workspaceId: string, archivedAt: string | null) => ({ workspaceId, projectId: "p1", cwd: `/tmp/${workspaceId}`, displayName: workspaceId, archivedAt });
const agent = (id: string, workspaceId: string, over: Partial<AgentSnapshot> = {}) => ({
  id, workspaceId, cwd: `/tmp/${workspaceId}`, provider: "codex", title: id, status: "closed", archivedAt: daysAgo(30),
  activeTurn: null, pendingPermissions: [], attentionReason: null, persistence: null, ...over,
}) as unknown as AgentSnapshot;

describe("selectDue", () => {
  const workspaces = [ws("old", daysAgo(10)), ws("fresh", daysAgo(1)), ws("active", null), ws("broken", "not-a-date")];

  test("只选归档满宽限期的 Workspace；刚归档、活跃、时间戳坏掉的都不算", () => {
    const agents = ["old", "fresh", "active", "broken"].map(w => agent(`a-${w}`, w));
    const due = selectDue(workspaces, agents, NOW, 7);
    expect(due.workspaceIds).toEqual(["old"]);
    expect(due.agents.map(a => a.id)).toEqual(["a-old"]);
  });

  test("宽限期边界：正好满 N 天就算到期", () => {
    expect(selectDue([ws("edge", daysAgo(7))], [agent("a", "edge")], NOW, 7).workspaceIds).toEqual(["edge"]);
  });

  test("Agent 本身未归档、未关闭或还有活动时不删；没有可删 Agent 的 Workspace 不计入", () => {
    const agents = [
      agent("unarchived", "old", { archivedAt: null }),
      agent("idle", "old", { status: "idle" }),
      agent("pending", "old", { pendingPermissions: [{}] as AgentSnapshot["pendingPermissions"] }),
    ];
    expect(selectDue(workspaces, agents, NOW, 7)).toEqual({ workspaceIds: [], agents: [] });
  });
});

describe("AutoCleaner", () => {
  let home: string;
  let agents: AgentSnapshot[];
  let prefs: CleanerPreferences;
  let now: number;
  let onList: (() => Promise<void>) | null;
  const paseo = {
    agents: {
      list: vi.fn(async () => {
        await onList?.();
        return { entries: agents.filter(a => !cli.deleted.includes(a.id)).map(a => ({ agent: a })), pageInfo: { nextCursor: null } };
      }),
    },
  } as unknown as PluginHandlerContext["paseo"];
  const writeRegistry = (rows: unknown[]) => writeFile(path.join(home, "projects/workspaces.json"), JSON.stringify(rows));
  const make = () => new AutoCleaner({ readSettings: async () => prefs, now: () => now, home: () => home });

  beforeEach(async () => {
    cli.deleted = [];
    onList = null;
    now = NOW;
    home = await mkdtemp(path.join(tmpdir(), "paseo-auto-cleanup-"));
    await mkdir(path.join(home, "projects"), { recursive: true });
    await writeRegistry([ws("old", daysAgo(10)), ws("fresh", daysAgo(1))]);
    await writeFile(path.join(home, "projects/projects.json"), JSON.stringify([{ projectId: "p1", rootPath: "/tmp", displayName: "P" }]));
    agents = [agent("a1", "old"), agent("a2", "old"), agent("a3", "fresh")];
    prefs = { ...cleanerSettings.schema.parse({}), autoCleanupArchived: true, autoCleanupGraceDays: 7 };
    vi.stubEnv("PASEO_HOME", home);
  });
  afterEach(() => vi.unstubAllEnvs());

  test("开关关闭时什么都不删，也不记录结果", async () => {
    prefs.autoCleanupArchived = false;
    const auto = make();
    await auto.trigger(paseo);
    expect(cli.deleted).toEqual([]);
    expect(auto.lastRun).toBeNull();
  });

  test("打开后只删到期 Workspace 下的 Agent，并记录本轮结果", async () => {
    const auto = make();
    await auto.trigger(paseo);
    expect(cli.deleted).toEqual(["a1", "a2"]);
    expect(auto.lastRun).toMatchObject({ workspaceCount: 1, deletedAgentCount: 2, removedPiSessionCount: 0, error: null });
  });

  test("没拿到 daemon 会话前不运行；拿到后按小时节流，force 可以绕过", async () => {
    const auto = make();
    expect(auto.trigger()).toBeNull();
    await auto.trigger(paseo);
    expect(cli.deleted).toEqual(["a1", "a2"]);

    agents.push(agent("a4", "old"));
    now += AUTO_INTERVAL_MS - 1;
    expect(auto.trigger(paseo)).toBeNull();
    await auto.trigger(undefined, { force: true });
    expect(cli.deleted).toEqual(["a1", "a2", "a4"]);
  });

  test("选定之后被 Restore 的 Workspace 跳过，不删其下 Agent", async () => {
    await writeRegistry([ws("old", daysAgo(10)), ws("old2", daysAgo(9))]);
    agents = [agent("a1", "old"), agent("b1", "old2")];
    // 删完第一个 Workspace 后（删除校验会再列一次 Agent）恢复第二个，模拟选定与删除之间的竞争。
    onList = async () => {
      if (cli.deleted.includes("a1")) { onList = null; await writeRegistry([ws("old", daysAgo(10)), ws("old2", null)]); }
    };
    const auto = make();
    await auto.trigger(paseo);
    expect(cli.deleted).toEqual(["a1"]);
    expect(auto.lastRun).toMatchObject({ workspaceCount: 1, deletedAgentCount: 1, warnings: ["old2: 已恢复，跳过"] });
  });

  test("手动清理进行中时让路，下一次触发立即重试", async () => {
    const auto = make();
    await withCleanupLock(async () => { await auto.trigger(paseo); });
    expect(cli.deleted).toEqual([]);
    await auto.trigger(paseo);
    expect(cli.deleted).toEqual(["a1", "a2"]);
  });

  test("读取失败时记录错误，不抛到事件回调里", async () => {
    await writeFile(path.join(home, "projects/workspaces.json"), "not json");
    const auto = make();
    await expect(auto.trigger(paseo)).resolves.toBeUndefined();
    expect(auto.lastRun?.error).toBeTruthy();
  });
});

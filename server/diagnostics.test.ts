import { readdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { cleanerSettings } from "../shared/settings";
import type { AutoCleaner } from "./auto-cleanup";
import { readDiagnostics } from "./diagnostics";

const paseo = {} as PluginHandlerContext["paseo"];
const prefs = { ...cleanerSettings.schema.parse({}), autoCleanupGraceDays: 14 };
let home: string;
let auto: AutoCleaner;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "paseo-diagnostics-"));
  vi.stubEnv("PASEO_HOME", home);
  // 子进程会继承 daemon 环境（包括 Paseo 自己注入的 PASEO_CLI），测试必须显式控制。
  vi.stubEnv("PASEO_CLI_PATH", "");
  vi.stubEnv("PASEO_CLI", "");
  auto = { due: vi.fn(async () => ({ workspaceCount: 2, agentCount: 5 })), lastRun: null } as unknown as AutoCleaner;
});
afterEach(() => { vi.unstubAllEnvs(); });

test("只读：报告 CLI 来源、按当前宽限期算出的到期范围，且不写任何文件", async () => {
  const report = await readDiagnostics({}, { paseo }, auto, prefs);
  expect(report).toEqual({ cliPath: "paseo", cliFromEnvironment: false, due: { workspaceCount: 2, agentCount: 5 }, lastAutoRun: null });
  expect(auto.due).toHaveBeenCalledWith(paseo, 14);
  expect(await readdir(home)).toEqual([]);
});

test("环境变量指定的 CLI 路径会被识别并展示", async () => {
  vi.stubEnv("PASEO_CLI_PATH", "/opt/paseo/bin/paseo");
  const report = await readDiagnostics({}, { paseo }, auto, prefs);
  expect(report.cliPath).toBe("/opt/paseo/bin/paseo");
  expect(report.cliFromEnvironment).toBe(true);
});

test("上次自动清理的结果原样返回", async () => {
  const lastRun = { at: "2026-10-13T00:00:00.000Z", workspaceCount: 1, deletedAgentCount: 3, removedPiSessionCount: 2, warnings: [], error: null };
  Object.assign(auto, { lastRun });
  expect((await readDiagnostics({}, { paseo }, auto, prefs)).lastAutoRun).toEqual(lastRun);
});

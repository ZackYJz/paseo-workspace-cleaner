import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const cli = vi.hoisted(() => ({ output: null as Record<string, unknown> | null, calls: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, result?: unknown) => void) => {
    cli.calls(args);
    if (!cli.output) return callback(new Error("spawn paseo ENOENT"));
    callback(null, { stdout: JSON.stringify(cli.output), stderr: "" });
  },
}));

import { readDiagnostics } from "./diagnostics";

let home: string;
const status = (over: Record<string, unknown> = {}) => ({
  home, listen: "127.0.0.1:6767", pid: 4242, serverId: "srv_test",
  localDaemon: "running", connectedDaemon: "reachable", desktopManaged: true,
  daemonVersion: "0.8.0", ...over,
});
// 诊断测试不依赖宿主机平台：非 macOS 上闸门本就会报告平台原因。
const platformIssues = process.platform === "darwin" ? [] : [`仅支持 macOS，当前为 ${process.platform}`];

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "paseo-diagnostics-"));
  vi.stubEnv("PASEO_HOME", home);
  // 子进程会继承 daemon 环境（包括 Paseo 自己注入的 PASEO_CLI），测试必须显式控制。
  vi.stubEnv("PASEO_CLI_PATH", "");
  vi.stubEnv("PASEO_CLI", "");
  cli.calls.mockClear();
  cli.output = status();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("诊断只读：报告 CLI、版本与闸门结论，且不写任何文件", async () => {
  const report = await readDiagnostics({});
  expect(report.daemonVersion).toBe("0.8.0");
  expect(report.supportedMinor).toBe("0.8");
  expect(report.cliFromEnvironment).toBe(false);
  expect(report.gateIssues).toEqual(platformIssues);
  expect(report.job).toBeNull();
  expect(cli.calls).toHaveBeenCalledWith(["daemon", "status", "--home", home, "--json"]);
  await expect(readdir(home)).resolves.toEqual([]);
});

test("环境变量指定的 CLI 路径会被识别并展示", async () => {
  vi.stubEnv("PASEO_CLI_PATH", "/opt/paseo/bin/paseo");
  const report = await readDiagnostics({});
  expect(report.cliFromEnvironment).toBe(true);
  expect(report.cliPath).toBe("/opt/paseo/bin/paseo");
});

test("版本线不匹配时给出原因，而不是让设置页显示可用", async () => {
  cli.output = status({ daemonVersion: "0.9.0" });
  const report = await readDiagnostics({});
  expect(report.gateIssues.join("；")).toContain("未经停机删除验证");
});

test("CLI 不可用时报告失败原因，不伪装成空闲可用", async () => {
  cli.output = null;
  const report = await readDiagnostics({});
  expect(report.daemonVersion).toBeNull();
  expect(report.gateIssues.join("；")).toContain("无法读取 daemon 状态");
});

test("上次停机任务结果一并返回", async () => {
  await mkdir(path.join(home, "workspace-cleaner"), { recursive: true });
  await writeFile(path.join(home, "workspace-cleaner/latest.json"), JSON.stringify({
    id: "job-1", phase: "completed", detail: "daemon 已恢复", updatedAt: "2026-09-10T01:00:00Z",
    backupDirectory: "/backup/job-1", deletedAgentIds: [], deletedWorkspaceIds: ["w1"], warnings: [],
  }));
  const report = await readDiagnostics({});
  expect(report.job?.phase).toBe("completed");
  expect(report.job?.deletedWorkspaceIds).toEqual(["w1"]);
});

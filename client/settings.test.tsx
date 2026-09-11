import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

const mocks = vi.hoisted(() => ({
  diagnostics: vi.fn(),
  settings: {
    status: "ready" as string,
    values: { deletePiSessionsByDefault: true, expandProjectsByDefault: true },
    revision: "r1", saving: false, saveError: null as string | null,
    save: vi.fn(async () => true), reset: vi.fn(async () => true), reload: vi.fn(async () => {}),
  },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => mocks.settings,
  useRpc: () => mocks.diagnostics,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement } = await import("react");
  const stub = (name: string) => (props: { children?: React.ReactNode }) => createElement(name, props, props.children);
  return {
    SettingsSection: stub("SettingsSection"),
    SettingsCard: stub("SettingsCard"),
    SettingsRow: stub("SettingsRow"),
    SettingsSwitch: stub("SettingsSwitch"),
    SettingsAction: stub("SettingsAction"),
  };
});
vi.mock("react-native", () => ({ Text: "Text" }));

import { CleanerSettings } from "./settings";

const props = {
  theme: { colors: { foreground: "#18181b", foregroundMuted: "#71717a" } },
  layout: { compact: false, platform: "web" }, host: { id: "test", label: "Test host" },
} as PluginSurfaceProps;
let renderer: ReactTestRenderer;
const visible = () => JSON.stringify(renderer.toJSON());
const all = (type: string) => renderer.root.findAllByType(type as never);
const diagnostics = (over: Record<string, unknown> = {}) => ({
  cliPath: "/usr/local/bin/paseo", cliFromEnvironment: false, supportedMinor: "0.8",
  daemonVersion: "0.8.0", gateIssues: [], job: null, ...over,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.assign(mocks.settings, {
    status: "ready", values: { deletePiSessionsByDefault: true, expandProjectsByDefault: true },
    revision: "r1", saving: false, saveError: null,
  });
  mocks.diagnostics.mockResolvedValue(diagnostics());
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
async function mount() {
  await act(async () => { renderer = create(<CleanerSettings {...props} />); });
}

test("开关展示已保存值，并带当前 revision 回写完整文档", async () => {
  await mount();
  const switches = all("SettingsSwitch");
  expect(switches).toHaveLength(2);
  expect(switches[0].props.value).toBe(true);
  await act(async () => switches[0].props.onValueChange(false));
  expect(mocks.settings.save).toHaveBeenCalledWith(
    { deletePiSessionsByDefault: false, expandProjectsByDefault: true }, "r1",
  );
});

test("闸门未通过时列出全部原因，而不是静默显示可用", async () => {
  mocks.diagnostics.mockResolvedValue(diagnostics({
    daemonVersion: "0.9.0",
    gateIssues: ["Paseo 0.9.0 未经停机删除验证，仅支持 0.8.x", "仅支持由 Paseo Desktop 管理的 daemon"],
  }));
  await mount();
  expect(visible()).toContain("未经停机删除验证");
  expect(visible()).toContain("Desktop 管理的 daemon");
});

test("诊断读取失败时显示错误，不呈现为空状态", async () => {
  mocks.diagnostics.mockRejectedValue(new Error("daemon 不可达"));
  await mount();
  expect(visible()).toContain("daemon 不可达");
});

test("上次停机任务的结果与阶段在设置页可见", async () => {
  mocks.diagnostics.mockResolvedValue(diagnostics({
    job: { id: "job-1", phase: "needs-recovery", detail: "daemon 未恢复", updatedAt: "2026-09-10T01:00:00Z", backupDirectory: "/backup/job-1", deletedAgentIds: ["a"], deletedWorkspaceIds: [], warnings: [] },
  }));
  await mount();
  expect(visible()).toContain("需要人工恢复");
  expect(visible()).toContain("/backup/job-1");
});

test("存储值无效时不把默认值当作已保存值，并提供重置入口", async () => {
  Object.assign(mocks.settings, { status: "invalid", error: "字段不符合当前版本" });
  await mount();
  expect(all("SettingsSwitch")).toHaveLength(0);
  expect(visible()).toContain("字段不符合当前版本");
  const action = all("SettingsAction")[0];
  expect(action.props.actionLabel).toBe("重置为默认值");
  await act(async () => action.props.onPress());
  expect(mocks.settings.reset).toHaveBeenCalled();
});

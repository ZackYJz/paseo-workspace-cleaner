import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

const DEFAULTS = vi.hoisted(() => ({ deletePiSessionsByDefault: true, expandProjectsByDefault: true, autoCleanupArchived: false, autoCleanupGraceDays: 7 }));
const mocks = vi.hoisted(() => ({
  diagnostics: vi.fn(),
  settings: {
    status: "ready" as string,
    values: { ...DEFAULTS },
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
    SettingsSelect: stub("SettingsSelect"),
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
  cliPath: "/usr/local/bin/paseo", cliFromEnvironment: false,
  due: { workspaceCount: 2, agentCount: 5 }, lastAutoRun: null, ...over,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.assign(mocks.settings, {
    status: "ready", values: { ...DEFAULTS },
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
  expect(switches).toHaveLength(3);
  expect(switches[0].props.value).toBe(true);
  await act(async () => switches[0].props.onValueChange(false));
  expect(mocks.settings.save).toHaveBeenCalledWith({ ...DEFAULTS, deletePiSessionsByDefault: false }, "r1");
});

test("自动清理默认关闭；打开开关与改宽限期都写回完整文档", async () => {
  await mount();
  const autoSwitch = all("SettingsSwitch")[2];
  expect(autoSwitch.props.value).toBe(false);
  await act(async () => autoSwitch.props.onValueChange(true));
  expect(mocks.settings.save).toHaveBeenCalledWith({ ...DEFAULTS, autoCleanupArchived: true }, "r1");
  const grace = all("SettingsSelect")[0];
  expect(grace.props.value).toBe("7");
  expect(grace.props.options.map((o: { value: string }) => o.value)).toEqual(["1", "3", "7", "14", "30"]);
  await act(async () => grace.props.onValueChange("14"));
  expect(mocks.settings.save).toHaveBeenCalledWith({ ...DEFAULTS, autoCleanupGraceDays: 14 }, "r1");
});

test("状态区显示到期范围与上次自动清理结果，失败原因可见", async () => {
  mocks.diagnostics.mockResolvedValue(diagnostics({
    lastAutoRun: { at: "2026-10-13T01:00:00Z", workspaceCount: 0, deletedAgentCount: 0, removedPiSessionCount: 0, warnings: [], error: "注册表读取失败" },
  }));
  await mount();
  expect(visible()).toContain("2 个已归档 Workspace · 5 个 Agent");
  expect(visible()).toContain("注册表读取失败");
});

test("还没运行过时如实说明，不显示成清理了 0 个", async () => {
  await mount();
  expect(visible()).toContain("插件本次启动后还没有运行过");
});

test("宽限期变化后重新读取到期范围", async () => {
  await mount();
  const calls = mocks.diagnostics.mock.calls.length;
  mocks.settings.values = { ...DEFAULTS, autoCleanupGraceDays: 30 };
  await act(async () => renderer.update(<CleanerSettings {...props} />));
  expect(mocks.diagnostics.mock.calls.length).toBe(calls + 1);
});

test("状态读取失败时显示错误，不呈现为空状态", async () => {
  mocks.diagnostics.mockRejectedValue(new Error("daemon 不可达"));
  await mount();
  expect(visible()).toContain("daemon 不可达");
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

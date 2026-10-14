import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginScreenProps } from "@getpaseo/plugin/client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), cleanup: vi.fn(), batch: vi.fn(), toast: { show: vi.fn(), error: vi.fn() },
  workspaceList: vi.fn(),
  catalog: vi.fn(),
  settings: {
    status: "ready" as const,
    values: { deletePiSessionsByDefault: true, expandProjectsByDefault: true },
    revision: "r1", saving: false, saveError: null as string | null,
    save: vi.fn(async () => true), reset: vi.fn(async () => true), reload: vi.fn(async () => {}),
  },
  agentPanel: { title: "这是 Agent 标题", provider: "pi", status: "idle" } as { title: string; provider: string; status: string } | null,
  workspace: { name: "真实 Workspace 名称", directory: "/tmp/project" } as { name: string; directory: string } | null,
}));

vi.mock("@getpaseo/plugin/client", () => {
  const paseo = { agents: { list: mocks.list }, workspaces: { list: mocks.workspaceList } };
  return {
    usePaseo: () => paseo,
    useRpc: (rpc: { name: string }) => rpc.name.endsWith(".catalog") ? mocks.catalog : rpc.name.endsWith(".agents.cleanup") ? mocks.batch : mocks.cleanup,
    useWorkspace: () => mocks.workspace,
    useAgent: () => mocks.agentPanel,
    useSettings: () => mocks.settings,
  };
});
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ height: 768, width: 400 }),
  ActivityIndicator: "Spinner", Pressable: "Button", ScrollView: "ScrollView",
  Switch: "Switch", Text: "Text", TextInput: "Input", View: "View",
}));
vi.mock("@getpaseo/plugin/client/react-native", () => {
  const Modal = Object.assign(({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null, { Content: "ModalContent" });
  return { Icon: "Icon", Modal, ScrollView: "ScrollView", useToast: () => mocks.toast };
});

import { MainSurface } from "./main";
import { WorkspaceCleanupSheet } from "./cleanup-dialog";
import { requestCleanup } from "./cleanup-intent";

const props = {
  theme: { colors: { foreground: "#18181b", foregroundMuted: "#71717a", surface0: "#fff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", accent: "#386f4d", accentForeground: "#fff", statusDanger: "#94433e", statusSuccess: "#386f4d", statusWarning: "#916c19" } },
  layout: { compact: false, platform: "web" }, host: { id: "test", label: "Test host" }, params: {},
} as PluginScreenProps;
const agent = { id: "agent-full-id-1", title: "这是 Agent 标题", workspaceId: "workspace-1", cwd: "/tmp/project", provider: "pi", status: "idle", archivedAt: null };
let renderer: ReactTestRenderer;
const button = (label: string) => renderer.root.findAllByType("Button" as never).find(node => node.props.accessibilityLabel === label)!;
const visible = () => JSON.stringify(renderer.toJSON());

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.settings.status = "ready";
  mocks.settings.values = { deletePiSessionsByDefault: true, expandProjectsByDefault: true };
  mocks.agentPanel = { title: "这是 Agent 标题", provider: "pi", status: "idle" };
  mocks.workspace = { name: "真实 Workspace 名称", directory: "/tmp/project" };
  mocks.list.mockResolvedValue({ entries: [{ agent }], pageInfo: { nextCursor: null } });
  // 显式默认值：clearAllMocks 不清实现，测试之间不能靠彼此遗留的返回值。
  mocks.cleanup.mockResolvedValue({ workspaceArchived: false, deletedAgentIds: [agent.id], piSessions: [], warnings: [] });
  mocks.batch.mockResolvedValue({ deletedAgentIds: [agent.id], piSessions: [], warnings: [] });
  mocks.workspaceList.mockImplementation(async () => ({ entries: mocks.workspace ? [{ id: "workspace-1", title: mocks.workspace.name, name: mocks.workspace.name, cwd: mocks.workspace.directory }] : [], pageInfo: { nextCursor: null } }));
  mocks.catalog.mockImplementation(async () => ({ projects: [{ projectId: "project-1", displayName: "真实 Project", rootPath: "/tmp/project" }],
    workspaces: mocks.workspace ? [{ workspaceId: "workspace-1", projectId: "project-1", displayName: mocks.workspace.name, cwd: mocks.workspace.directory, archivedAt: null }] : []}));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
async function mount(compact = false) {
  await act(async () => { renderer = create(<MainSurface {...props} layout={{ ...props.layout, compact }} />); });
}
async function mountSheet(close: () => void) {
  await act(async () => { renderer = create(<WorkspaceCleanupSheet {...props} context="workspace" workspaceId="workspace-1" close={close} />); });
}
async function press(label: string) { await act(async () => button(label).props.onPress()); }

const closed = { ...agent, id: "agent-closed", title: "已关闭的会话", status: "closed" };
const archived = { ...agent, id: "agent-archived", title: "已归档的会话", status: "closed", archivedAt: "2026-09-01" };
const withAgents = (...list: Array<Record<string, unknown>>) => mocks.list.mockResolvedValue({ entries: list.map(a => ({ agent: a })), pageInfo: { nextCursor: null } });
const tab = (label: string) => renderer.root.findAllByType("Button" as never).find(node => node.props.accessibilityRole === "tab" && String(node.props.accessibilityLabel).startsWith(label))!;
const input = () => renderer.root.findByType("Input" as never);

test("defaults to the cleanable filter: idle agents stay hidden until 全部 is chosen", async () => {
  withAgents(agent, closed, archived);
  await mount();
  expect(visible()).toContain("已关闭的会话");
  expect(visible()).toContain("已归档的会话");
  expect(visible()).not.toContain("这是 Agent 标题");
  expect(tab("可清理").props.accessibilityLabel).toBe("可清理 2");
  expect(tab("可清理").props.accessibilityState.selected).toBe(true);
  await act(async () => tab("全部").props.onPress());
  expect(visible()).toContain("这是 Agent 标题");
});

test("falls back to 全部 when nothing is cleanable instead of showing an empty page", async () => {
  await mount();
  expect(tab("全部").props.accessibilityState.selected).toBe(true);
  expect(visible()).toContain("这是 Agent 标题");
  expect(visible()).toContain("真实 Workspace 名称");
});

test("search matches titles and workspace names, and an empty result offers to clear it", async () => {
  withAgents(closed, archived);
  await mount();
  await act(async () => input().props.onChangeText("归档"));
  expect(visible()).toContain("已归档的会话");
  expect(visible()).not.toContain("已关闭的会话");
  await act(async () => input().props.onChangeText("真实 workspace"));
  expect(visible()).toContain("已关闭的会话");
  await act(async () => input().props.onChangeText("不存在"));
  expect(visible()).toContain("没有匹配「不存在」的 Agent");
  await press("清空搜索");
  expect(visible()).toContain("已关闭的会话");
});

test("rows and the workspace checkbox drive one selection, shown in the bottom bar", async () => {
  withAgents(closed, archived);
  await mount();
  const workspaceBox = () => button("选择 真实 Workspace 名称 下全部 Agent");
  expect(workspaceBox().props.accessibilityState.checked).toBe(false);
  await press("选择 已关闭的会话");
  expect(workspaceBox().props.accessibilityState.checked).toBe("mixed");
  expect(visible()).toContain("已选 1 个 Agent");
  await act(async () => workspaceBox().props.onPress());
  expect(workspaceBox().props.accessibilityState.checked).toBe(true);
  expect(visible()).toContain("已选 2 个 Agent");
  await press("取消");
  expect(visible()).not.toContain("已选");
});

test("batch delete lists the selection, forwards the Pi opt-out and keeps failures in the dialog", async () => {
  withAgents(closed, archived);
  mocks.batch.mockRejectedValueOnce(new Error("拒绝删除测试对象"));
  await mount();
  await act(async () => button("选择 真实 Workspace 名称 下全部 Agent").props.onPress());
  await press("删除 2 个");
  expect(visible()).toContain("2 个 Agent 与全部时间线");
  expect(mocks.batch).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType("Switch" as never).props.onValueChange(false));
  const confirm = () => renderer.root.findAllByType("Button" as never).filter(node => node.props.accessibilityLabel === "删除 2 个").at(-1)!;
  await act(async () => confirm().props.onPress());
  expect(mocks.batch).toHaveBeenCalledWith({ agentIds: ["agent-closed", "agent-archived"], deletePiSessions: false, confirmation: "DELETE" });
  expect(visible()).toContain("拒绝删除测试对象");
});

test("a successful batch delete clears the selection and refreshes", async () => {
  withAgents(closed, archived);
  mocks.batch.mockResolvedValue({ deletedAgentIds: ["agent-closed"], piSessions: [], warnings: [] });
  await mount();
  await press("选择 已关闭的会话");
  await press("删除 1 个");
  const listCalls = mocks.list.mock.calls.length;
  const confirm = renderer.root.findAllByType("Button" as never).filter(node => node.props.accessibilityLabel === "删除 1 个").at(-1)!;
  await act(async () => confirm.props.onPress());
  expect(mocks.toast.show).toHaveBeenCalledWith("已删除 1 个 Agent。", { variant: "success" });
  expect(visible()).not.toContain("已选");
  expect(mocks.list.mock.calls.length).toBeGreaterThan(listCalls);
});

test("the batch dialog warns when the selection still has live agents", async () => {
  await mount();
  await press("选择 这是 Agent 标题");
  await press("删除 1 个");
  expect(visible()).toContain("其中 1 个还没结束");
});

test("archive-and-clean stays a quiet icon on active workspaces and confirms before running", async () => {
  await mount();
  await press("归档并清理 真实 Workspace 名称");
  expect(visible()).toContain("包括未归档的 Agent");
  expect(mocks.cleanup).not.toHaveBeenCalled();
  await press("确认删除");
  expect(mocks.cleanup).toHaveBeenCalledWith({ workspaceId: "workspace-1", deletePiSessions: true, onlyFinished: false, confirmation: "DELETE" });
});

test("archived workspaces show a badge and no archive action; empty archived ones are hidden", async () => {
  withAgents({ ...archived, workspaceId: "archived-1" });
  mocks.catalog.mockResolvedValue({ projects: [], workspaces: [
    { workspaceId: "archived-1", projectId: "p", displayName: "旧归档", cwd: "/tmp/project", archivedAt: "2026-09-01" },
    { workspaceId: "archived-2", projectId: "p", displayName: "空归档 Workspace", cwd: "/tmp/project", archivedAt: "2026-09-01" },
  ] });
  await mount();
  expect(visible()).toContain("旧归档");
  expect(visible()).toContain("已归档");
  expect(button("归档并清理 旧归档")).toBeUndefined();
  expect(visible()).not.toContain("空归档 Workspace");
});

test("load failure and first load are never shown as an empty page", async () => {
  mocks.list.mockRejectedValueOnce(new Error("daemon 不可达"));
  await mount();
  expect(visible()).toContain("daemon 不可达");
  expect(visible()).not.toContain("暂时不用清理");
  await act(async () => renderer.unmount());
  mocks.list.mockReturnValueOnce(new Promise(() => {}));
  await mount();
  expect(visible()).toContain("正在读取");
  expect(visible()).not.toContain("没有 Agent");
});

test("projects collapse independently, follow the default-collapse setting, and survive refresh", async () => {
  await mount();
  expect(visible()).toContain("这是 Agent 标题");
  await press("折叠 真实 Project");
  expect(visible()).not.toContain("这是 Agent 标题");
  await press("刷新");
  expect(button("展开 真实 Project")).toBeDefined();
  await act(async () => renderer.unmount());
  mocks.settings.values = { ...mocks.settings.values, expandProjectsByDefault: false };
  await mount();
  expect(visible()).not.toContain("这是 Agent 标题");
  await press("展开 真实 Project");
  expect(visible()).toContain("这是 Agent 标题");
});

test("Pi session 开关的初始值来自插件设置，而不是写死的 true", async () => {
  mocks.settings.values = { ...mocks.settings.values, deletePiSessionsByDefault: false };
  await mount();
  await press("选择 这是 Agent 标题");
  await press("删除 1 个");
  expect(renderer.root.findByType("Switch" as never).props.value).toBe(false);
});

const radio = (label: string) => renderer.root.findAllByType("Button" as never).find(node => node.props.accessibilityRole === "radio" && String(node.props.accessibilityLabel).startsWith(label))!;

test("header 浮层先列范围再给按钮，确认后调用 RPC 并关闭浮层", async () => {
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(visible()).toContain("真实 Workspace 名称");
  expect(visible()).toContain("这是 Agent 标题");
  // 机器 ID 不再出现在浮层里
  expect(visible()).not.toContain("workspace-1");
  expect(radio("全部 Agent").props.accessibilityState.checked).toBe(true);
  await press("删除 1 个 Agent");
  expect(mocks.cleanup).toHaveBeenCalledWith({ workspaceId: "workspace-1", deletePiSessions: true, onlyFinished: false, confirmation: "DELETE" });
  expect(close).toHaveBeenCalled();
});

test("没有已归档或已关闭 Agent 时，「仅已关闭或已归档」不可选", async () => {
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(radio("仅已关闭或已归档").props.disabled).toBe(true);
  expect(radio("仅已关闭或已归档").props.accessibilityLabel).toBe("仅已关闭或已归档，0 个");
});

test("选「仅已关闭或已归档」只提交已结束范围，按钮数量跟着变，其余行标为保留", async () => {
  mocks.list.mockResolvedValue({ entries: [
    { agent: { ...agent, id: "archived-1", title: "已归档的一个", status: "closed", archivedAt: "2026-09-01" } },
    { agent: { ...agent, id: "closed-1", title: "已关闭的一个", status: "closed", archivedAt: null } },
    { agent },
  ], pageInfo: { nextCursor: null } });
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  const keptTags = () => renderer.root.findAllByType("Text" as never).filter(node => node.props.children === "保留").length;
  expect(visible()).toContain("删除 3 个 Agent");
  expect(keptTags()).toBe(0);
  await act(async () => radio("仅已关闭或已归档").props.onPress());
  expect(visible()).toContain("删除 2 个 Agent");
  expect(keptTags()).toBe(1);
  await press("删除 2 个 Agent");
  expect(mocks.cleanup).toHaveBeenCalledWith({ workspaceId: "workspace-1", deletePiSessions: true, onlyFinished: true, confirmation: "DELETE" });
  expect(close).toHaveBeenCalled();
});

test("范围里没有 Pi Agent 时不显示 Pi 会话开关，也不提交删除 Pi 会话", async () => {
  withAgents({ ...agent, provider: "codex" });
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(renderer.root.findAllByType("Switch" as never)).toHaveLength(0);
  await press("删除 1 个 Agent");
  expect(mocks.cleanup).toHaveBeenCalledWith(expect.objectContaining({ deletePiSessions: false }));
});

test("Pi 会话开关关掉后按关闭提交", async () => {
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  await act(async () => renderer.root.findByType("Switch" as never).props.onValueChange(false));
  await press("删除 1 个 Agent");
  expect(mocks.cleanup).toHaveBeenCalledWith(expect.objectContaining({ deletePiSessions: false }));
});

test("删除失败时错误留在浮层里，不关闭", async () => {
  mocks.cleanup.mockRejectedValueOnce(new Error("拒绝删除测试对象"));
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  await press("删除 1 个 Agent");
  expect(visible()).toContain("拒绝删除测试对象");
  expect(close).not.toHaveBeenCalled();
});

test("header 浮层读取中显示待定文案，取消只关闭浮层", async () => {
  const close = vi.fn();
  mocks.list.mockReturnValue(new Promise(() => {}));
  await mountSheet(close);
  expect(visible()).toContain("正在读取清理范围…");
  expect(visible()).not.toContain("此 Workspace 下没有 Agent");
  await press("取消");
  expect(close).toHaveBeenCalled();
  expect(mocks.cleanup).not.toHaveBeenCalled();
});

test("header 浮层读取失败显示错误，不伪装成没有 Agent", async () => {
  const close = vi.fn();
  mocks.list.mockRejectedValue(new Error("连接已断开"));
  await mountSheet(close);
  await act(async () => {});
  expect(visible()).toContain("连接已断开");
  expect(visible()).not.toContain("此 Workspace 下没有 Agent");
});

test("命令意图在主页挂载时自动弹出 workspace 确认窗口，取消后清除", async () => {
  requestCleanup({ kind: "workspace", id: "workspace-1" });
  await mount();
  await act(async () => {});
  expect(visible()).toContain("确认删除");
  expect(visible()).toContain("真实 Workspace 名称");
  expect(visible()).toContain("workspace-1");
  await press("取消");
  expect(visible()).not.toContain("确认删除");
});

test("命令意图在主页挂载时自动弹出 agent 确认窗口", async () => {
  requestCleanup({ kind: "agent", id: "agent-full-id-1" });
  await mount();
  await act(async () => {});
  expect(visible()).toContain("确认删除");
  expect(visible()).toContain("这是 Agent 标题");
  expect(visible()).toContain("agent-full-id-1");
});

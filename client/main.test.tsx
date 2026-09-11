import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), cleanup: vi.fn(), toast: { show: vi.fn(), error: vi.fn() },
  workspaceList: vi.fn(),
  catalog: vi.fn(), preview: vi.fn(), start: vi.fn(),
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
    useRpc: (rpc: { name: string }) => rpc.name.endsWith(".catalog") ? mocks.catalog : rpc.name.endsWith(".preview") ? mocks.preview : rpc.name.endsWith(".start") ? mocks.start : mocks.cleanup,
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
  layout: { compact: false, platform: "web" }, host: { id: "test", label: "Test host" },
} as PluginSurfaceProps;
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
  mocks.workspaceList.mockImplementation(async () => ({ entries: mocks.workspace ? [{ id: "workspace-1", title: mocks.workspace.name, name: mocks.workspace.name, cwd: mocks.workspace.directory }] : [], pageInfo: { nextCursor: null } }));
  mocks.catalog.mockImplementation(async () => ({ projects: [{ projectId: "project-1", displayName: "真实 Project", rootPath: "/tmp/project" }],
    workspaces: mocks.workspace ? [{ workspaceId: "workspace-1", projectId: "project-1", displayName: mocks.workspace.name, cwd: mocks.workspace.directory, archivedAt: null }] : [], job: null }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
async function mount(compact = false) {
  await act(async () => { renderer = create(<MainSurface {...props} layout={{ ...props.layout, compact }} />); });
}
async function mountSheet(close: () => void) {
  await act(async () => { renderer = create(<WorkspaceCleanupSheet {...props} context="workspace" workspaceId="workspace-1" close={close} />); });
}
async function press(label: string) { await act(async () => button(label).props.onPress()); }

test("completed job details are quiet by default and expand on demand", async () => {
  const catalog = await mocks.catalog();
  mocks.catalog.mockResolvedValue({ ...catalog, job: { id: "old-job", phase: "completed", detail: "执行细节", updatedAt: "2026-09-09T01:00:00Z", backupDirectory: "/backup/result", deletedAgentIds: ["a"], deletedWorkspaceIds: ["w"], warnings: ["session 已移入废纸篓"] } });
  await mount();
  expect(visible()).toContain("清理完成");
  expect(visible()).not.toContain("/backup/result");
  expect(visible()).not.toContain("执行细节");
  await press("查看清理详情");
  expect(visible()).toContain("/backup/result");
  expect(visible()).toContain("session 已移入废纸篓");
  await press("收起清理详情");
  expect(visible()).not.toContain("/backup/result");
});

test("recovery errors remain visible without opening details", async () => {
  const catalog = await mocks.catalog();
  mocks.catalog.mockResolvedValue({ ...catalog, job: { id: "failed-job", phase: "needs-recovery", detail: "daemon 未恢复，请检查", updatedAt: "2026-09-09T01:00:00Z", backupDirectory: "/backup/result", deletedAgentIds: [], deletedWorkspaceIds: [], warnings: [] } });
  await mount();
  expect(visible()).toContain("daemon 未恢复，请检查");
  expect(visible()).not.toContain("/backup/result");
});

test("workspaces sort by latest agent activity and refresh preserves project collapse", async () => {
  const catalog = await mocks.catalog();
  mocks.catalog.mockResolvedValue({ ...catalog, workspaces: [
    { ...catalog.workspaces[0], displayName: "旧工作区" },
    { ...catalog.workspaces[0], workspaceId: "workspace-2", displayName: "新工作区" },
  ] });
  mocks.list.mockResolvedValue({ entries: [
    { agent: { ...agent, updatedAt: "2026-09-01" } },
    { agent: { ...agent, id: "agent-2", workspaceId: "workspace-2", updatedAt: "2026-09-09" } },
  ], pageInfo: { nextCursor: null } });
  await mount();
  expect(visible().indexOf("新工作区")).toBeLessThan(visible().indexOf("旧工作区"));
  await press("折叠 真实 Project");
  await press("刷新");
  expect(visible()).not.toContain("新工作区");
  expect(button("展开 真实 Project")).toBeDefined();
});

test("renders the workspace name and exact identity, not a duplicate agent title", async () => {
  await mount();
  expect(visible()).toContain("真实 Workspace 名称");
  expect(visible()).toContain("workspace-1");
  expect(visible().split("这是 Agent 标题")).toHaveLength(2);
});

test("unavailable workspace remains identifiable and is not grouped by cwd", async () => {
  mocks.workspace = null;
  mocks.list.mockResolvedValue({ entries: [{ agent }, { agent: { ...agent, id: "agent-2", workspaceId: "workspace-2" } }], pageInfo: { nextCursor: null } });
  await mount(true);
  expect(visible()).toContain("workspace-1");
  expect(visible()).toContain("workspace-2");
  expect(renderer.root.findAllByType("Button" as never).filter(node => node.props.accessibilityLabel === "清理全部")).toHaveLength(2);
});

test("load failure is not presented as an empty list", async () => {
  mocks.list.mockRejectedValue(new Error("连接已断开"));
  await mount();
  expect(visible()).toContain("连接已断开");
  expect(visible()).not.toContain("没有可清理的 Agent");
});

test("loading is not presented as an empty list", async () => {
  mocks.list.mockReturnValue(new Promise(() => {}));
  await mount();
  expect(visible()).toContain("正在读取会话");
  expect(visible()).not.toContain("没有可清理的 Agent");
});

test("confirmation needs no typing, and opening or cancelling never runs the RPC", async () => {
  await mount(true);
  await press("删除");
  expect(visible()).toContain("agent-full-id-1");
  expect(renderer.root.findAllByType("Input" as never)).toHaveLength(0);
  expect(button("确认删除").props.disabled).toBe(false);
  await press("取消");
  await press("删除");
  expect(button("确认删除").props.disabled).toBe(false);
  expect(mocks.cleanup).not.toHaveBeenCalled();
});

test("Pi opt-out is forwarded and RPC failure stays visible in the confirmation", async () => {
  mocks.cleanup.mockRejectedValue(new Error("拒绝删除测试对象"));
  await mount();
  await press("删除");
  await act(async () => renderer.root.findByType("Switch" as never).props.onValueChange(false));
  await press("确认删除");
  expect(mocks.cleanup).toHaveBeenCalledWith({ agentId: agent.id, deletePiSession: false, confirmation: "DELETE" });
  expect(visible()).toContain("拒绝删除测试对象");
  expect(mocks.toast.show).not.toHaveBeenCalled();
});

test("workspace confirmation explicitly includes unarchived agents and retained registry", async () => {
  await mount();
  await press("清理全部");
  expect(visible()).toContain("包括未归档的 Agent");
  expect(visible()).toContain("保留项目文件和 Workspace 归档记录");
  expect(renderer.root.findAllByType("Input" as never)).toHaveLength(0);
  expect(button("确认删除").props.disabled).toBe(false);
  expect(mocks.cleanup).not.toHaveBeenCalled();
});

test("pending deletion disables confirmation, cancellation and the Pi switch", async () => {
  let rejectRequest!: (error: Error) => void;
  mocks.cleanup.mockImplementation(() => new Promise((_, reject) => { rejectRequest = reject; }));
  await mount();
  await press("删除");
  await press("确认删除");
  expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  expect(button("正在删除…").props.disabled).toBe(true);
  expect(button("取消").props.disabled).toBe(true);
  expect(renderer.root.findByType("Switch" as never).props.disabled).toBe(true);
  await act(async () => rejectRequest(new Error("模拟请求失败")));
  expect(button("确认删除").props.disabled).toBe(false);
  expect(visible()).toContain("模拟请求失败");
});

test("projects collapse independently and restore their workspace and agent content", async () => {
  await mount();
  await press("折叠 真实 Project");
  expect(visible()).not.toContain("这是 Agent 标题");
  expect(visible()).toContain("真实 Project");
  expect(button("展开 真实 Project").props.accessibilityState.expanded).toBe(false);
  await press("展开 真实 Project");
  expect(visible()).toContain("这是 Agent 标题");
});

test("distinct Project identities sharing a path remain separate and independently collapsible", async () => {
  mocks.catalog.mockResolvedValue({ projects: [{ projectId: "p1", displayName: "项目一", rootPath: "/same" }, { projectId: "p2", displayName: "项目二", rootPath: "/same" }],
    workspaces: [{ workspaceId: "workspace-1", projectId: "p1", displayName: "会话一", cwd: "/same", archivedAt: null }, { workspaceId: "workspace-2", projectId: "p2", displayName: "会话二", cwd: "/same", archivedAt: null }], job: null });
  await mount();
  await press("折叠 项目一");
  expect(visible()).not.toContain("会话一");
  expect(visible()).toContain("会话二");
  expect(button("折叠 项目二").props.accessibilityState.expanded).toBe(true);
});

test("empty archived workspace is shown and cannot execute a blocked offline preview", async () => {
  mocks.list.mockResolvedValue({ entries: [], pageInfo: {} });
  mocks.catalog.mockResolvedValue({ projects: [], workspaces: [{ workspaceId: "archived-1", projectId: "p", displayName: "空归档 Workspace", cwd: "/tmp/project", archivedAt: "2026-09-01" }], job: null });
  mocks.preview.mockResolvedValue({ token: "preview", workspaceIds: ["archived-1"], agentIds: [], blockers: ["有 Agent 正在运行"], workspaces: [], piSessionCount: 0, unarchivedAgentCount: 0 });
  await mount();
  expect(visible()).toContain("空归档 Workspace");
  await press("预览停机清理");
  expect(visible()).toContain("有 Agent 正在运行");
  expect(button("确认删除").props.disabled).toBe(true);
  expect(mocks.start).not.toHaveBeenCalled();
});

test("bulk confirmation includes Pi sessions, submits only the server preview token and needs no typing", async () => {
  mocks.catalog.mockResolvedValue({ projects: [], workspaces: [{ workspaceId: "workspace-1", projectId: "p", displayName: "已归档", cwd: "/tmp/project", archivedAt: "2026-09-01" }], job: null });
  mocks.preview.mockResolvedValue({ token: "preview", workspaceIds: ["workspace-1"], agentIds: [agent.id], blockers: [], workspaces: [{ workspaceId: "workspace-1", projectName: "项目", name: "归档一", cwd: "/tmp/project", agentCount: 1 }], piSessionCount: 1, unarchivedAgentCount: 1 });
  mocks.start.mockRejectedValue(new Error("范围变化"));
  await mount(); await press("预览停机清理");
  expect(mocks.preview).toHaveBeenCalledWith({});
  expect(visible()).toContain("未单独归档的 Agent");
  expect(visible()).toContain("归档一");
  expect(renderer.root.findAllByType("Switch" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("Input" as never)).toHaveLength(0);
  await press("确认删除");
  expect(mocks.start).toHaveBeenCalledWith({ token: "preview", confirmation: "DELETE" });
  expect(mocks.toast.show).not.toHaveBeenCalled();
});

test("there is one bulk card, no per-workspace shutdown buttons, and an empty card cannot start", async () => {
  await mount();
  expect(visible()).toContain("统一停机清理");
  expect(button("预览停机清理").props.disabled).toBe(true);
  expect(renderer.root.findAllByType("Button" as never).filter(n => n.props.accessibilityLabel === "预览停机清理")).toHaveLength(1);
  expect(button("停机删除")).toBeUndefined();
  expect(mocks.start).not.toHaveBeenCalled();
});
test("Project disclosure has no transform in either pressed state, but retains focus and background feedback", async () => {
  await mount();
  const group = button("折叠 真实 Project");
  const pressed = Object.assign({}, ...group.props.style({ pressed: true }));
  const normal = Object.assign({}, ...group.props.style({ pressed: false }));
  expect(pressed.transform).toBeUndefined(); expect(normal.transform).toBeUndefined();
  expect(pressed.backgroundColor).not.toBe(normal.backgroundColor);
  await act(async () => group.props.onFocus());
  expect(Object.assign({}, ...button("折叠 真实 Project").props.style({ pressed: false })).borderColor).toBe(props.theme.colors.accent);
});

test("Pi session 开关的初始值来自插件设置，而不是写死的 true", async () => {
  mocks.settings.values = { deletePiSessionsByDefault: false, expandProjectsByDefault: true };
  mocks.cleanup.mockResolvedValue({ deletedAgentIds: [agent.id], piSessions: [], warnings: [] });
  await mount();
  await press("删除");
  expect(renderer.root.findByType("Switch" as never).props.value).toBe(false);
  await press("确认删除");
  expect(mocks.cleanup).toHaveBeenCalledWith({ agentId: agent.id, deletePiSession: false, confirmation: "DELETE" });
});

test("Project 分组可按设置默认折叠，且仍能手动展开", async () => {
  mocks.settings.values = { deletePiSessionsByDefault: true, expandProjectsByDefault: false };
  await mount();
  expect(visible()).not.toContain("这是 Agent 标题");
  expect(button("展开 真实 Project").props.accessibilityState.expanded).toBe(false);
  await press("展开 真实 Project");
  expect(visible()).toContain("这是 Agent 标题");
});

test("header 浮层列出清理范围，确认后调用 RPC 并关闭浮层", async () => {
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(visible()).toContain("真实 Workspace 名称");
  expect(visible()).toContain("1 个 Agent 与全部时间线");
  expect(visible()).toContain("这是 Agent 标题");
  await press("清理全部");
  expect(mocks.cleanup).toHaveBeenCalledWith({ workspaceId: "workspace-1", deletePiSessions: true, onlyFinished: false, confirmation: "DELETE" });
  expect(close).toHaveBeenCalled();
});

test("没有已归档或已关闭 Agent 时，仅清理按钮禁用", async () => {
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(button("仅已关闭").props.disabled).toBe(true);
});

test("仅清理按钮只提交已结束范围，不碰 idle 与 running", async () => {
  mocks.list.mockResolvedValue({ entries: [
    { agent: { ...agent, id: "archived-1", title: "已归档的一个", status: "closed", archivedAt: "2026-09-01" } },
    { agent: { ...agent, id: "closed-1", title: "已关闭的一个", status: "closed", archivedAt: null } },
    { agent },
  ], pageInfo: { nextCursor: null } });
  const close = vi.fn();
  await mountSheet(close);
  await act(async () => {});
  expect(visible()).toContain("仅已关闭（2）");
  await press("仅已关闭（2）");
  expect(mocks.cleanup).toHaveBeenCalledWith({ workspaceId: "workspace-1", deletePiSessions: true, onlyFinished: true, confirmation: "DELETE" });
  expect(close).toHaveBeenCalled();
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

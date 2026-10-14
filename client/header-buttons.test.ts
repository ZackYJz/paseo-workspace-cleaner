import { afterEach, beforeEach, expect, test, vi } from "vitest";

// header-buttons 现在引用浮层内容组件，需要把宿主与 react-native 桩掉，避免拉入真实包。
vi.mock("react-native", () => ({ Pressable: "Button", Switch: "Switch", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({ agents: { list: vi.fn() } }),
  useRpc: () => vi.fn(),
  useWorkspace: () => null,
  useSettings: () => ({ status: "ready", values: { deletePiSessionsByDefault: true, expandProjectsByDefault: true } }),
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: "Icon",
  Modal: Object.assign(() => null, { Content: "ModalContent" }),
  ScrollView: "ScrollView",
  useToast: () => ({ show: vi.fn() }),
}));

import { contributeHeaderButtons } from "./header-buttons";

type Button = { title: string; icon: string; behavior: { kind: "popover"; Content: unknown } | { kind: "action"; onPress(): void } };
type Client = Parameters<typeof contributeHeaderButtons>[0];

type Observer = { snapshot(value: unknown): void; update(message: unknown): void };

// 按 daemon 的真实语义建模：只有 `list({ subscribe: {} })` 建立的观察才会收到更新，
// 不提供本地 `workspaces.subscribe`，代码若退回只挂本地监听器，测试会直接失败。
function fakeClient(initial: string[]) {
  let ids = initial;
  const registered = new Map<string, { removed: boolean; button: Button }>();
  const observers = new Set<Observer>();
  const release = vi.fn(async () => { observers.clear(); });
  const openPanel = vi.fn();
  const page = () => ({ entries: ids.map((id) => ({ id })), pageInfo: { nextCursor: null } });
  const list = vi.fn(async () => page());
  const observe = vi.fn(async () => ({
    ...page(),
    subscriptionId: "sub-1",
    subscription: {
      subscribe(observer: Observer) { observers.add(observer); return () => { observers.delete(observer); }; },
      release,
    },
  }));
  const client = {
    paseo: {
      workspaces: {
        list: (options?: { subscribe?: unknown }) => (options?.subscribe ? observe() : list()),
      },
    },
    addHeaderButton(contribution: { workspaceId: string; button: Button }) {
      const entry = { removed: false, button: contribution.button };
      registered.set(contribution.workspaceId, entry);
      return { update: vi.fn(), remove: () => { entry.removed = true; } };
    },
    openPanel,
  };
  return {
    client: client as unknown as Client,
    registered,
    openPanel,
    list,
    observe,
    release,
    setWorkspaces(next: string[]) { ids = next; },
    emit() { for (const observer of [...observers]) observer.update({ type: "workspace_update" }); },
    reconnect() { for (const observer of [...observers]) observer.snapshot(page()); },
    subscribed: () => observers.size,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test("为每个 workspace 注册按钮，点击弹清理浮层而非新 tab，卸载时全部移除", async () => {
  const fake = fakeClient(["w1", "w2"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.registered.size).toBe(2));
  expect(fake.registered.get("w1")!.button.title).toBe("清理此 Workspace");
  const behavior = fake.registered.get("w1")!.button.behavior;
  expect(behavior.kind).toBe("popover");
  expect((behavior as { Content: unknown }).Content).toBeTypeOf("function");
  cleanup();
  expect([...fake.registered.values()].every((entry) => entry.removed)).toBe(true);
  expect(fake.subscribed()).toBe(0);
  expect(fake.release).toHaveBeenCalled();
});

test("插件加载后新建的 workspace 也会拿到按钮（建立了自己的目录观察）", async () => {
  const fake = fakeClient(["w1"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.subscribed()).toBe(1));
  expect(fake.observe).toHaveBeenCalledTimes(1);
  fake.setWorkspaces(["w1", "w-new"]);
  fake.emit();
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(fake.registered.has("w-new")).toBe(true));
  cleanup();
});

test("重连后的快照会补上断线期间新建的 workspace", async () => {
  const fake = fakeClient(["w1"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.subscribed()).toBe(1));
  fake.setWorkspaces(["w1", "w-offline"]);
  fake.reconnect();
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(fake.registered.has("w-offline")).toBe(true));
  cleanup();
});

test("workspace 消失后移除其按钮，新 workspace 会补上", async () => {
  const fake = fakeClient(["w1"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.subscribed()).toBe(1));
  fake.setWorkspaces(["w2"]);
  fake.emit();
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => {
    expect(fake.registered.get("w1")!.removed).toBe(true);
    expect(fake.registered.has("w2")).toBe(true);
  });
  cleanup();
});

test("列表暂时不可用时保留已注册按钮，不把它们全部撤掉", async () => {
  const fake = fakeClient(["w1"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.registered.size).toBe(1));
  fake.setWorkspaces([]);
  fake.list.mockRejectedValueOnce(new Error("连接已断开"));
  await vi.waitFor(() => expect(fake.subscribed()).toBe(1));
  fake.emit();
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(fake.list).toHaveBeenCalledTimes(2));
  expect(fake.registered.get("w1")!.removed).toBe(false);
  cleanup();
});

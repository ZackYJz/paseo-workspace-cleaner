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

function fakeClient(initial: string[]) {
  let ids = initial;
  const registered = new Map<string, { removed: boolean; button: Button }>();
  const handlers = new Set<() => void>();
  const openPanel = vi.fn();
  const list = vi.fn(async () => ({ entries: ids.map((id) => ({ id })), pageInfo: { nextCursor: null } }));
  const client = {
    paseo: {
      workspaces: {
        list,
        subscribe(handler: () => void) { handlers.add(handler); return () => { handlers.delete(handler); }; },
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
    setWorkspaces(next: string[]) { ids = next; },
    emit() { for (const handler of [...handlers]) handler(); },
    subscribed: () => handlers.size,
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
});

test("workspace 消失后移除其按钮，新 workspace 会补上", async () => {
  const fake = fakeClient(["w1"]);
  const cleanup = contributeHeaderButtons(fake.client);
  await vi.waitFor(() => expect(fake.registered.size).toBe(1));
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
  fake.emit();
  await vi.waitFor(() => expect(fake.list).toHaveBeenCalledTimes(2));
  expect(fake.registered.get("w1")!.removed).toBe(false);
  cleanup();
});

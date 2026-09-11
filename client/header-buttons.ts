import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { WorkspaceCleanupSheet } from "./cleanup-dialog";

const PAGE_SIZE = 200;
const SYNC_DEBOUNCE_MS = 400;

// 0.8 的 header 按钮按 workspace 注册，所以要跟随 workspace 列表增删。
// 订阅事件只当作「有变化」的信号：统一重新拉取列表再做差量，
// 不耦合事件负载结构，也避免每个事件都触发一次注册。
export function contributeHeaderButtons(client: PluginClientContext) {
  const buttons = new Map<string, PluginButtonRegistration>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncing: Promise<void> | null = null;
  let dirty = false;
  let stopped = false;

  async function sync() {
    const seen = new Set<string>();
    try {
      let cursor: string | undefined;
      do {
        const page = await client.paseo.workspaces.list({ page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
        for (const workspace of page.entries) {
          if (stopped) return;
          seen.add(workspace.id);
          if (buttons.has(workspace.id)) continue;
          const workspaceId = workspace.id;
          buttons.set(workspaceId, client.addHeaderButton({
            id: "workspace-cleanup",
            workspaceId,
            button: {
              title: "清理此 Workspace",
              icon: "Trash2",
              // 点击不再开新 tab：宿主在宽屏弹锚定卡片、窄屏弹底部 sheet。
              behavior: { kind: "popover", Content: WorkspaceCleanupSheet },
            },
          }));
        }
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor && !stopped);
    } catch {
      // 列表暂时不可用时保留已注册的按钮，下一个事件会重试。
      return;
    }
    for (const [workspaceId, registration] of [...buttons]) {
      if (seen.has(workspaceId)) continue;
      registration.remove();
      buttons.delete(workspaceId);
    }
  }

  async function run() {
    if (syncing) { dirty = true; return; }
    syncing = (async () => {
      do {
        dirty = false;
        await sync();
      } while (dirty && !stopped);
      syncing = null;
    })();
    await syncing;
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; void run(); }, SYNC_DEBOUNCE_MS);
  }

  const unsubscribe = client.paseo.workspaces.subscribe(schedule);
  void run();

  return () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    unsubscribe();
    for (const registration of buttons.values()) registration.remove();
    buttons.clear();
  };
}

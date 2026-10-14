import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { WorkspaceCleanupSheet } from "./cleanup-dialog";

const PAGE_SIZE = 200;
const SYNC_DEBOUNCE_MS = 400;

// 0.8 的 header 按钮按 workspace 注册，所以要跟随 workspace 列表增删。
// 订阅事件只当作「有变化」的信号：统一重新拉取列表再做差量，
// 不耦合事件负载结构，也避免每个事件都触发一次注册。
//
// 变化信号必须来自自己持有的 `list({ subscribe: {} })` 观察：`workspaces.subscribe()`
// 只是本地监听器，没有观察时 daemon 不会推送任何更新，插件加载后新建的 workspace
// 就永远拿不到按钮（表现为最新的会话右上角没有垃圾桶）。观察在重连后会再推一次快照，
// 断线期间漏掉的增删也由那次快照补上。
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

  let stopObserving: (() => void) | null = null;
  let release: (() => Promise<void>) | null = null;
  void client.paseo.workspaces
    .list({ subscribe: {}, page: { limit: 1 } })
    .then(({ subscription }) => {
      if (stopped) { void subscription.release(); return; }
      release = () => subscription.release();
      stopObserving = subscription.subscribe({ snapshot: schedule, update: schedule, error: schedule });
    })
    // 建不起观察时退化为只在加载时同步一次；下次插件或 app 重载会重试。
    .catch(() => {});
  void run();

  return () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    stopObserving?.();
    void release?.();
    for (const registration of buttons.values()) registration.remove();
    buttons.clear();
  };
}

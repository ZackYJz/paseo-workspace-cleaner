// 清理意图深链：Command Center 与 /clean 只能路由或调 RPC，起不了浮层，
// 所以它们把意图存到这里并打开主页，由主页消费意图弹出确认窗口。
export type CleanupIntent =
  | { readonly kind: "workspace"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string };

type Listener = (intent: CleanupIntent) => void;

let pending: CleanupIntent | null = null;
const listeners = new Set<Listener>();

export function requestCleanup(intent: CleanupIntent): void {
  // 主页已挂载时直接通知，不留待取意图，避免下次挂载重复弹窗。
  if (listeners.size === 0) pending = intent;
  for (const listener of listeners) listener(intent);
}

export function takePendingCleanup(): CleanupIntent | null {
  const value = pending;
  pending = null;
  return value;
}

export function onCleanupRequested(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

import type { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";

type Paseo = ReturnType<typeof usePaseo>;
type Observer = { snapshot(value: unknown): void; update(message: unknown): void; error?(error: unknown): void };
type Owned = { subscribe(observer: Observer): () => void; release(): Promise<void> };

const DEBOUNCE_MS = 500;

// 只把会影响这一页的字段当作变化：流式输出每个片段都会改写 updatedAt，
// 拿它当信号会让页面在 Agent 跑起来时不停重读。
function agentKey(agent: Record<string, unknown>): string {
  return JSON.stringify([agent.workspaceId ?? null, agent.status, agent.archivedAt ?? null,
    agent.requiresAttention ?? null, agent.attentionReason ?? null, agent.title ?? null]);
}
function workspaceKey(workspace: Record<string, unknown>): string {
  const diff = workspace.diffStat as { additions?: number; deletions?: number } | null | undefined;
  return JSON.stringify([workspace.title ?? null, workspace.name, workspace.status ?? null,
    workspace.archivingAt ?? null, diff?.additions ?? null, diff?.deletions ?? null]);
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;

/**
 * 跟随 agent 与 workspace 目录，有生命周期级的变化时调用 onChange（合并去抖）。
 * 订阅是本页自己持有的观察：`subscribe()` 只是本地监听器，没有观察时 daemon 什么都不推。
 * 重连后观察会再推一次快照，这里把快照也当作一次变化，断线期间漏掉的由它补上。
 */
export function useLiveDirectory(paseo: Paseo, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const keys = new Map<string, string | null>();
    const cleanups: Array<() => void> = [];
    const schedule = () => {
      if (stopped || timer) return;
      timer = setTimeout(() => { timer = null; if (!stopped) latest.current(); }, DEBOUNCE_MS);
    };
    // 返回 true 表示确实变了；同一键值的重复事件（流式噪音）被吞掉。
    const remember = (id: string, key: string | null) => {
      if (keys.has(id) && keys.get(id) === key) return false;
      keys.set(id, key);
      return true;
    };

    function onUpdate(message: unknown) {
      const payload = record(record(message)?.payload);
      const type = record(message)?.type;
      if (!payload) return schedule();
      if (type === "agent_update") {
        const agent = record(payload.agent);
        const id = payload.kind === "remove" ? String(payload.agentId) : String(agent?.id);
        if (remember(`a:${id}`, payload.kind === "remove" || !agent ? null : agentKey(agent))) schedule();
      } else if (type === "workspace_update") {
        const workspace = record(payload.workspace);
        const id = payload.kind === "remove" ? String(payload.id) : String(workspace?.id);
        if (remember(`w:${id}`, payload.kind === "remove" || !workspace ? null : workspaceKey(workspace))) schedule();
      }
    }

    function seed(prefix: "a" | "w", value: unknown) {
      const entries = record(value)?.entries;
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        const item = prefix === "a" ? record(record(entry)?.agent) : record(entry);
        if (item?.id) keys.set(`${prefix}:${String(item.id)}`, prefix === "a" ? agentKey(item) : workspaceKey(item));
      }
    }

    async function observe(prefix: "a" | "w", open: () => Promise<{ subscription: Owned } & Record<string, unknown>>) {
      try {
        const result = await open();
        if (stopped) { void result.subscription.release(); return; }
        seed(prefix, result);
        let first = true;
        const unsubscribe = result.subscription.subscribe({
          // 第一次快照就是刚才 seed 的那份；之后的快照来自重连，当作变化。
          snapshot: (value) => { if (first) { first = false; return; } seed(prefix, value); schedule(); },
          update: onUpdate,
          error: schedule,
        });
        cleanups.push(() => { unsubscribe(); void result.subscription.release(); });
      } catch {
        // 建不起观察时页面仍可手动刷新。
      }
    }

    void observe("a", () => paseo.agents.list({ filter: { includeArchived: true }, subscribe: {}, page: { limit: 200 } }) as never);
    void observe("w", () => paseo.workspaces.list({ subscribe: {}, page: { limit: 200 } }) as never);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
    };
  }, [paseo]);
}

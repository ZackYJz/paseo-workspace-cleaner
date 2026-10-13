import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { WorkspaceRecord } from "../shared/catalog";
import type { AutoRunResult, CleanerPreferences } from "../shared/settings";
import { cleanupBusy, deleteAgents, listAllAgents, withCleanupLock } from "./cleanup";
import { catalog, cleanerHome, isBusyAgent, type AgentSnapshot } from "./registry";

type PaseoApi = PluginHandlerContext["paseo"];
const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_INTERVAL_MS = 60 * 60 * 1000;

// 到期判定是纯函数：Workspace 归档满宽限期，且其下 Agent 本身已归档、已关闭、没有活动。
// 时间戳解析不了的一律不算到期；没有可删 Agent 的 Workspace 不计入。
export function selectDue(workspaces: readonly WorkspaceRecord[], agents: readonly AgentSnapshot[], now: number, graceDays: number) {
  const cutoff = now - graceDays * DAY_MS;
  const expired = new Set(workspaces
    .filter(w => w.archivedAt && Date.parse(w.archivedAt) <= cutoff)
    .map(w => w.workspaceId));
  const targets = agents.filter(a => a.workspaceId && expired.has(a.workspaceId) &&
    a.archivedAt && a.status === "closed" && !isBusyAgent(a));
  const workspaceIds = [...new Set(targets.map(a => a.workspaceId!))].sort();
  return { workspaceIds, agents: targets };
}

/**
 * 插件服务端没有常驻的 Paseo 客户端，只有 RPC 和生命周期事件的上下文里带 `paseo`。
 * 所以从第一次事件或调用里拿到它，之后由事件触发、按小时节流；事件回调里不 await，避开 30 秒超时。
 */
export class AutoCleaner {
  private paseo: PaseoApi | null = null;
  private lastAttempt = 0;
  private running: Promise<void> | null = null;
  private stopped = false;
  lastRun: AutoRunResult | null = null;

  constructor(private readonly deps: {
    readSettings: () => Promise<CleanerPreferences | null>;
    now?: () => number;
    home?: () => string;
    log?: (line: string) => void;
  }) {}

  private now() { return this.deps.now?.() ?? Date.now(); }

  /** 记住 daemon 会话并按节流尝试一轮；`force` 用于开关刚打开时立即检查。 */
  trigger(paseo?: PaseoApi, options: { force?: boolean } = {}): Promise<void> | null {
    if (paseo) this.paseo ??= paseo;
    if (this.stopped || !this.paseo || this.running) return this.running;
    if (!options.force && this.now() - this.lastAttempt < AUTO_INTERVAL_MS) return null;
    this.lastAttempt = this.now();
    this.running = this.run(this.paseo).finally(() => { this.running = null; });
    return this.running;
  }

  stop() { this.stopped = true; }

  async due(paseo: PaseoApi, graceDays: number) {
    const [{ workspaces }, agents] = await Promise.all([catalog(this.deps.home?.() ?? cleanerHome()), listAllAgents(paseo)]);
    const due = selectDue(workspaces, agents, this.now(), graceDays);
    return { workspaceCount: due.workspaceIds.length, agentCount: due.agents.length };
  }

  private async run(paseo: PaseoApi) {
    const at = new Date(this.now()).toISOString();
    try {
      const prefs = await this.deps.readSettings();
      if (!prefs?.autoCleanupArchived) return;
      // 手动清理正在跑：不排队，不报错，下一次触发再试。
      if (cleanupBusy()) { this.lastAttempt = 0; return; }
      const result = await withCleanupLock(async () => {
        const home = this.deps.home?.() ?? cleanerHome();
        const [{ workspaces }, agents] = await Promise.all([catalog(home), listAllAgents(paseo)]);
        const due = selectDue(workspaces, agents, this.now(), prefs.autoCleanupGraceDays);
        const summary: AutoRunResult = { at, workspaceCount: 0, deletedAgentCount: 0, removedPiSessionCount: 0, warnings: [], error: null };
        for (const workspaceId of due.workspaceIds) {
          // 每个 Workspace 删除前重读注册表：期间被 Restore 的不再动。
          const current = (await catalog(home)).workspaces.find(w => w.workspaceId === workspaceId);
          if (!current?.archivedAt) { summary.warnings.push(`${workspaceId}: 已恢复，跳过`); continue; }
          const targets = due.agents.filter(a => a.workspaceId === workspaceId);
          const deleted = await deleteAgents(targets, paseo, prefs.deletePiSessionsByDefault);
          summary.workspaceCount += deleted.deletedAgentIds.length ? 1 : 0;
          summary.deletedAgentCount += deleted.deletedAgentIds.length;
          summary.removedPiSessionCount += deleted.piSessions.filter(s => s.status === "trashed" || s.status === "quarantined").length;
          summary.warnings.push(...deleted.warnings);
        }
        return summary;
      });
      this.lastRun = result;
      this.deps.log?.(`[workspace-cleaner] 自动清理：${result.workspaceCount} 个 Workspace，${result.deletedAgentCount} 个 Agent，${result.removedPiSessionCount} 个 Pi session${result.warnings.length ? `；${result.warnings.join("；")}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastRun = { at, workspaceCount: 0, deletedAgentCount: 0, removedPiSessionCount: 0, warnings: [], error: message };
      this.deps.log?.(`[workspace-cleaner] 自动清理失败：${message}`);
    }
  }
}

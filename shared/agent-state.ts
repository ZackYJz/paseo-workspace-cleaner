/**
 * Agent 与 Workspace 状态 → 文案、色调、排序。
 *
 * 会话页的状态点、状态文字、「需要处理 / 运行中」筛选和「等你处理」区都从这里取，
 * 同一个状态在每一行读起来一样、排起来也一样。从原 workspace-agent-count 插件并入。
 */

export type Tone = "danger" | "warning" | "success" | "accent" | "muted";

export interface StateMeta {
  readonly label: string;
  readonly tone: Tone;
  /** 越小越靠前：要你处理的排最前。 */
  readonly rank: number;
}

/** 结构化声明：shared 代码两端都编译，不能引宿主 SDK 类型。 */
export interface PresentedAgent {
  status?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  archivedAt?: string | null;
}

const ARCHIVED: StateMeta = { label: "已归档", tone: "muted", rank: 60 };
const PERMISSION: StateMeta = { label: "等待授权", tone: "danger", rank: 0 };
const ERROR: StateMeta = { label: "出错", tone: "danger", rank: 1 };
const NEEDS_ATTENTION: StateMeta = { label: "需要处理", tone: "warning", rank: 2 };
const RUNNING: StateMeta = { label: "运行中", tone: "accent", rank: 10 };
const INITIALIZING: StateMeta = { label: "启动中", tone: "accent", rank: 11 };
const FINISHED: StateMeta = { label: "已完成", tone: "success", rank: 20 };
const IDLE: StateMeta = { label: "空闲", tone: "muted", rank: 40 };
const CLOSED: StateMeta = { label: "已关闭", tone: "muted", rank: 50 };

/**
 * 一个 Agent 只取一个状态，优先级是刻意的：
 * - 已归档压过一切：它只为计数和清理保留，不该借活跃 Agent 的紧迫感。
 * - 具体的 attentionReason 先于笼统的 requiresAttention，两者都先于 status，因为宿主说明了原因。
 * - 仍在输出的状态先于「已完成」：还在跑就不算完，不管遗留的 attention 怎么说。
 */
export function agentState(agent: PresentedAgent): StateMeta {
  if (agent.archivedAt) return ARCHIVED;
  if (agent.attentionReason === "permission") return PERMISSION;
  if (agent.attentionReason === "error" || agent.status === "error") return ERROR;
  if (agent.requiresAttention === true) return NEEDS_ATTENTION;
  if (agent.status === "running") return RUNNING;
  if (agent.status === "initializing") return INITIALIZING;
  if (agent.attentionReason === "finished") return FINISHED;
  if (agent.status === "closed") return CLOSED;
  return IDLE;
}

/** 宿主自己对 Workspace 的汇总，不从 Agent 重推，所以和原生侧栏不会矛盾。 */
export function workspaceState(status: string | null | undefined): StateMeta {
  switch (status) {
    case "needs_input": return { label: "需要输入", tone: "danger", rank: 0 };
    case "failed": return { label: "失败", tone: "danger", rank: 1 };
    case "attention": return { label: "需要处理", tone: "warning", rank: 2 };
    case "running": return RUNNING;
    case "done": return FINISHED;
    default: return IDLE;
  }
}

/** 值得写出状态名的状态。空闲、已关闭、已归档是常态，只靠状态点表达。 */
export function isNotable(meta: StateMeta): boolean {
  return meta.tone !== "muted";
}

export const needsAttention = (meta: StateMeta) => meta.tone === "danger" || meta.tone === "warning";
export const isRunningState = (meta: StateMeta) => meta.tone === "accent";

/** 1234 → 1.2k，37604 → 38k，1495950 → 1.5M；小数字保持精确。 */
export function compactCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return String(value);
  if (abs < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (abs < 1_000_000) return `${Math.round(value / 1000)}k`;
  if (abs < 10_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

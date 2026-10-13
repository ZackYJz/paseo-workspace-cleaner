export interface ActivityRecord { updatedAt?: string | null; createdAt?: string | null }

export function activityTime(record?: ActivityRecord): number {
  for (const value of [record?.updatedAt, record?.createdAt]) {
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

// Paseo initializes agent lastActivityAt from updatedAt. Registry edits are not
// agent activity: use workspace creation only when no agent timestamp is known.
export function workspaceActivity(workspace: ActivityRecord | undefined, agents: ActivityRecord[]): number {
  return Math.max(0, ...agents.map(activityTime)) || activityTime({ createdAt: workspace?.createdAt });
}

export function activityLabel(time: number): string {
  if (!time) return "暂无活跃记录";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `最近活跃 ${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 列表行用相对时间，比绝对时间短，扫读更快；超过 30 天回到日期。
export function relativeLabel(time: number, now: number = Date.now()): string {
  if (!time) return "无活动";
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = new Date(time);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

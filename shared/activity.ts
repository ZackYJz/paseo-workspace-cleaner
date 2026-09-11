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

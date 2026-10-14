import { type PluginScreenProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { activityTime, relativeLabel, workspaceActivity } from "../shared/activity";
import { agentState, compactCount, isNotable, isRunningState, needsAttention, workspaceState, type Tone } from "../shared/agent-state";
import { catalogRpc, type ProjectRecord, type WorkspaceRecord } from "../shared/catalog";
import { cleanupAgentsRpc, isFinishedAgent } from "../shared/cleanup";
import { onCleanupRequested, takePendingCleanup, type CleanupIntent } from "./cleanup-intent";
import { ConfirmCleanup, useAgentCleanup, useWorkspaceCleanup } from "./cleanup-dialog";
import { ActionButton, agentStatusText, listAllAgents, type CleanupTheme, type ListedAgent } from "./cleanup-ui";
import { useCleanupDefaults } from "./defaults";
import { useLiveDirectory } from "./live-refresh";

type Colors = CleanupTheme["colors"];
type Filter = "all" | "attention" | "running" | "cleanable";
type Navigation = PluginScreenProps["navigation"];
type LiveWorkspace = { status: string | null; diffStat: { additions: number; deletions: number } | null };

function toneColor(colors: Colors, tone: Tone): string {
  return tone === "danger" ? colors.statusDanger : tone === "warning" ? colors.statusWarning
    : tone === "success" ? colors.statusSuccess : tone === "accent" ? colors.accent : colors.foregroundMuted;
}

// 只给 6 位 hex 叠透明度；主题色不是这种格式时退回中性底色，不猜。
function tint(color: string, alpha: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : fallback;
}

function useStyles(colors: Colors, compact: boolean) {
  return useMemo(() => ({
    root: { flex: 1, minWidth: 0, backgroundColor: colors.surface0 },
    scroll: { flex: 1, minWidth: 0 },
    content: { width: "100%" as const, maxWidth: 880, alignSelf: "center" as const, paddingHorizontal: compact ? 12 : 24, paddingTop: compact ? 12 : 20, gap: 16 },
    headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minWidth: 0 },
    stats: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
    toolbar: { flexDirection: compact ? "column" as const : "row" as const, alignItems: compact ? "stretch" as const : "center" as const, gap: 8, minWidth: 0 },
    segment: { flexDirection: "row" as const, padding: 2, borderRadius: 8, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignSelf: compact ? "stretch" as const : "auto" as const },
    // 窄屏按内容宽度分剩余空间，不强制等宽：四个筛选等宽会超出 375 宽的屏幕。
    segmentItem: { flexGrow: compact ? 1 : 0, flexShrink: 1, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: compact ? 4 : 6, height: 28, paddingHorizontal: compact ? 8 : 12, borderRadius: 6 },
    segmentText: { color: colors.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
    segmentCount: { color: colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
    search: { flex: compact ? undefined : 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: 8, height: 34, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
    searchInput: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 0, outlineStyle: "none" as never },
    list: { gap: 20 },
    projectHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 4, minWidth: 0 },
    projectName: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 0.4 },
    projectCount: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, opacity: 0.7 },
    // 每个 Project 一个连续列表；Workspace 是列表里的分组行，不再各自成卡。
    group: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" as const },
    workspaceRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface1, minWidth: 0 },
    workspaceDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    workspaceName: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" as const, flexShrink: 1 },
    workspaceMeta: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
    badge: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 4, borderWidth: 1, borderColor: colors.border, overflow: "hidden" as const },
    agentRow: { flexDirection: compact ? "column" as const : "row" as const, alignItems: compact ? "stretch" as const : "center" as const, gap: compact ? 2 : 10, minHeight: compact ? 52 : 38, paddingHorizontal: 12, paddingVertical: compact ? 8 : 6, borderTopWidth: 1, borderTopColor: colors.border, minWidth: 0 },
    agentMain: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flex: compact ? undefined : 1, minWidth: 0 },
    agentTitle: { color: colors.foreground, fontSize: 14, lineHeight: 20, flex: 1, minWidth: 0 },
    agentMeta: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, flexShrink: 0, paddingLeft: compact ? 44 : 0, fontVariant: ["tabular-nums" as const] },
    empty: { alignItems: "center" as const, gap: 10, paddingVertical: 48 },
    emptyText: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20, textAlign: "center" as const },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 20 },
    bar: { position: "absolute" as const, left: 0, right: 0, bottom: 0, alignItems: "center" as const, paddingHorizontal: compact ? 12 : 24, paddingBottom: compact ? 12 : 16, pointerEvents: "box-none" as const },
    barInner: { width: "100%" as const, maxWidth: 832, flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingLeft: 14, paddingRight: 8, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
    barText: { color: colors.foreground, fontSize: 13, fontWeight: "500" as const, flex: 1, minWidth: 0 },
    scopeList: { gap: 4, maxHeight: 220 },
    scopeItem: { color: colors.foreground, fontSize: 13, lineHeight: 20 },
    scopeMeta: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
    warning: { color: colors.statusWarning, fontSize: 12, lineHeight: 18 },
    panel: { borderRadius: 10, borderWidth: 1, borderColor: colors.statusDanger, overflow: "hidden" as const },
    panelHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
    panelTitle: { color: colors.statusDanger, fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
    panelRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: 0 },
    pill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
    pillText: { fontSize: 11, lineHeight: 15, fontWeight: "600" as const },
    diff: { fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums" as const] },
  }), [colors, compact]);
}
type Styles = ReturnType<typeof useStyles>;

function StatusDot({ agent, colors }: { agent: ListedAgent; colors: Colors }) {
  // 实心 = 状态有话要说（等待授权、出错、运行中、已完成），空心 = 常态（空闲、已关闭、已归档）。
  const state = agentState(agent);
  const solid = state.tone !== "muted";
  const color = toneColor(colors, state.tone);
  return <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: color, backgroundColor: solid ? color : "transparent", opacity: agent.archivedAt ? 0.6 : 1 }} />;
}

function Checkbox({ state, colors, label, onPress }: { state: "on" | "off" | "mixed"; colors: Colors; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: state === "mixed" ? "mixed" : state === "on" }}
      hitSlop={8} onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.88 : 1 }] })}>
      <Icon name={state === "on" ? "SquareCheck" : state === "mixed" ? "SquareMinus" : "Square"} size={16} color={state === "off" ? colors.foregroundMuted : colors.accent} />
    </Pressable>
  );
}

function Segment({ value, onChange, counts, styles, colors }: { value: Filter; onChange: (v: Filter) => void; counts: Record<Filter, number>; styles: Styles; colors: Colors }) {
  // 状态类筛选的数量带颜色，扫一眼工具栏就知道有没有要处理的。
  const items: Array<[Filter, string, Tone | null]> = [["all", "全部", null], ["attention", "需要处理", "danger"], ["running", "运行中", "accent"], ["cleanable", "可清理", null]];
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {items.map(([key, label, tone]) => {
        const active = key === value;
        const countColor = tone && counts[key] > 0 ? toneColor(colors, tone) : active ? colors.foreground : undefined;
        return (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`${label} ${counts[key]}`}
            onPress={() => onChange(key)}
            style={({ pressed }) => [styles.segmentItem, active && { backgroundColor: colors.surface0 }, pressed && !active && { opacity: 0.7 }]}>
            <Text style={[styles.segmentText, active && { color: colors.foreground }]}>{label}</Text>
            <Text style={[styles.segmentCount, countColor ? { color: countColor } : null]}>{counts[key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AttentionPanel({ agents, labelOf, navigation, styles, colors }: {
  agents: ListedAgent[]; labelOf: (agent: ListedAgent) => string; navigation: Navigation; styles: Styles; colors: Colors;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Icon name="BellRing" size={13} color={colors.statusDanger} />
        <Text style={styles.panelTitle}>{`等你处理 · ${agents.length}`}</Text>
      </View>
      {agents.map(agent => {
        const state = agentState(agent);
        const since = Date.parse(agent.attentionTimestamp ?? "") || activityTime(agent);
        const body = (
          <>
            <StatusDot agent={agent} colors={colors} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.agentTitle} numberOfLines={2}>{agent.title ?? "未命名 Agent"}</Text>
              <Text style={styles.workspaceMeta} numberOfLines={1}>{labelOf(agent)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={[styles.agentMeta, { color: toneColor(colors, state.tone), fontWeight: "600" }]}>{state.label}</Text>
              <Text style={styles.agentMeta}>{relativeLabel(since)}</Text>
            </View>
          </>
        );
        return navigation ? (
          <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`打开 ${agent.title ?? agent.id}，${state.label}`}
            onPress={() => navigation.openAgent({ agentId: agent.id })}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.panelRow, (pressed || hovered) && { backgroundColor: colors.surface1 }]}>
            {body}
          </Pressable>
        ) : <View key={agent.id} style={styles.panelRow}>{body}</View>;
      })}
    </View>
  );
}

function AgentRow({ agent, selected, onToggle, navigation, styles, colors, compact }: { agent: ListedAgent; selected: boolean; onToggle: () => void; navigation: Navigation; styles: Styles; colors: Colors; compact: boolean }) {
  const state = agentState(agent);
  const rest = `${agent.provider} · ${relativeLabel(activityTime(agent))}`;
  // 点行打开会话，点勾选框才是选中（同邮件列表）。宿主没有 navigation 时退回整行勾选。
  const open = navigation ? () => navigation.openAgent({ agentId: agent.id }) : onToggle;
  return (
    <Pressable accessibilityRole={navigation ? "button" : "checkbox"} accessibilityState={navigation ? undefined : { checked: selected }}
      accessibilityLabel={`${navigation ? "打开 " : ""}${agent.title ?? "未命名 Agent"}，${state.label} · ${rest}`}
      onPress={open}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.agentRow,
        selected ? { backgroundColor: tint(colors.accent, "1f", colors.surface2) } : (pressed || hovered) ? { backgroundColor: colors.surface1 } : null]}>
      <View style={styles.agentMain}>
        <Checkbox state={selected ? "on" : "off"} colors={colors} label={`选择 ${agent.title ?? agent.id}`} onPress={onToggle} />
        <StatusDot agent={agent} colors={colors} />
        <Text style={[styles.agentTitle, agent.archivedAt ? { color: colors.foregroundMuted } : null]} numberOfLines={compact ? 2 : 1}>{agent.title ?? "未命名 Agent"}</Text>
      </View>
      <Text style={styles.agentMeta}>
        <Text style={isNotable(state) ? { color: toneColor(colors, state.tone), fontWeight: "600" } : null}>{state.label}</Text>
        {` · ${rest}`}
      </Text>
    </Pressable>
  );
}

function WorkspaceGroup({ first, workspace, workspaceId, live, navigation, projectRoot, agents, selected, onToggle, onToggleAll, onDone, styles, colors, theme }: {
  first: boolean; workspace?: WorkspaceRecord; workspaceId?: string; live?: LiveWorkspace; navigation: Navigation; projectRoot?: string; agents: ListedAgent[];
  selected: ReadonlySet<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[], on: boolean) => void; onDone: () => void;
  styles: Styles; colors: Colors; theme: CleanupTheme;
}) {
  const ids = agents.map(a => a.id);
  const picked = ids.filter(id => selected.has(id)).length;
  const state = picked === 0 ? "off" : picked === ids.length ? "on" : "mixed";
  const name = workspace?.title || workspace?.displayName || (workspaceId ? "Workspace" : "未关联 Workspace");
  const cwd = workspace?.cwd ?? agents[0]?.cwd;
  // 只在不是 Project 根目录时给出位置，取最后一段（通常是 worktree 名），完整路径放无障碍标签里。
  const place = cwd && cwd !== projectRoot ? cwd.split("/").filter(Boolean).pop() : undefined;
  // 要你处理的排前面，同一档里最近活动的在前。
  const sorted = [...agents].sort((a, b) => agentState(a).rank - agentState(b).rank || activityTime(b) - activityTime(a) || a.id.localeCompare(b.id));
  const wsState = workspaceState(live?.status);
  const diff = live?.diffStat;
  const showDiff = Boolean(diff && (diff.additions || diff.deletions));
  const openWorkspace = navigation && workspaceId && !workspace?.archivedAt ? () => navigation.openWorkspace({ workspaceId }) : undefined;
  const title = <Text style={styles.workspaceName} numberOfLines={1}>{name}</Text>;
  return (
    <View style={first ? null : styles.workspaceDivider}>
      <View style={styles.workspaceRow} accessibilityLabel={`Workspace ${name}${cwd ? `，${cwd}` : ""}`}>
        <Checkbox state={state} colors={colors} label={`选择 ${name} 下全部 Agent`} onPress={() => onToggleAll(ids, state !== "on")} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {/* 窄屏允许状态胶囊和 diff 折到下一行，不把页面最小宽度撑大。 */}
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: theme.compact ? "wrap" : "nowrap", columnGap: 8, rowGap: 2, minWidth: 0 }}>
            {openWorkspace ? (
              <Pressable accessibilityRole="link" accessibilityLabel={`打开 Workspace ${name}`} onPress={openWorkspace}
                style={({ pressed }) => ({ flexShrink: 1, minWidth: 0, opacity: pressed ? 0.6 : 1 })}>
                {title}
              </Pressable>
            ) : title}
            {workspace?.archivedAt ? <Text style={styles.badge}>已归档</Text> : null}
            {!workspace?.archivedAt && isNotable(wsState) && wsState.tone !== "success" ? (
              <View style={[styles.pill, { borderColor: toneColor(colors, wsState.tone) }]}>
                <Text style={[styles.pillText, { color: toneColor(colors, wsState.tone) }]}>{wsState.label}</Text>
              </View>
            ) : null}
            {showDiff && diff ? (
              <Text style={styles.diff}>
                <Text style={{ color: colors.statusSuccess }}>{`+${compactCount(diff.additions)}`}</Text>
                <Text style={{ color: colors.statusDanger }}>{` −${compactCount(diff.deletions)}`}</Text>
              </Text>
            ) : null}
          </View>
          <Text style={styles.workspaceMeta} numberOfLines={1}>
            {[`${agents.length} 个 Agent`, relativeLabel(workspaceActivity(workspace, agents)), place].filter(Boolean).join(" · ")}
          </Text>
        </View>
        {workspaceId && !workspace?.archivedAt ? <WorkspaceCleanupAction workspaceId={workspaceId} label={name} theme={theme} onDone={onDone} trigger="icon" /> : null}
      </View>
      {sorted.map(agent => (
        <AgentRow key={agent.id} agent={agent} selected={selected.has(agent.id)} onToggle={() => onToggle(agent.id)} navigation={navigation} styles={styles} colors={colors} compact={theme.compact} />
      ))}
    </View>
  );
}

function ProjectSection({ label, workspaceIds, agents, collapsed, onCollapse, children, styles, colors }: {
  label: string; workspaceIds: string[]; agents: ListedAgent[]; collapsed: boolean; onCollapse: () => void;
  children: React.ReactNode; styles: Styles; colors: Colors;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed ? "展开" : "折叠"} ${label}`} accessibilityState={{ expanded: !collapsed }}
        onPress={onCollapse} style={({ pressed }) => [styles.projectHead, pressed && { opacity: 0.6 }]}>
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={colors.foregroundMuted} />
        <Text style={styles.projectName} numberOfLines={1}>{label}</Text>
        <Text style={styles.projectCount} numberOfLines={1}>{`${workspaceIds.length} 个 Workspace · ${agents.length} 个 Agent`}</Text>
      </Pressable>
      {collapsed ? null : <View style={styles.group}>{children}</View>}
    </View>
  );
}

function AgentCleanupAction({ agentId, label, theme, onDone }: { agentId: string; label: string; theme: CleanupTheme; onDone: () => void }) {
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [deletePiSession, setDeletePiSession] = useState(deletePiSessionsByDefault);
  const { busy, error, run } = useAgentCleanup();
  return (
    <ConfirmCleanup open title="删除 Agent" identity={`${label}\n${agentId}`}
      detail="永久删除此 Agent 的 Paseo 记录与时间线，无法撤销。不删除项目文件。"
      error={error} deletePiSessions={deletePiSession} busy={busy} theme={theme}
      onDeletePiSessionsChange={setDeletePiSession} onOpenChange={value => { if (!value) onDone(); }}
      confirmLabel="确认删除" onConfirm={() => { void run({ agentId, deletePiSession }).then(ok => { if (ok) onDone(); }); }} />
  );
}

function WorkspaceCleanupAction({ workspaceId, label, theme, onDone, trigger, autoOpen = false, onDismiss }: {
  workspaceId: string; label: string; theme: CleanupTheme; onDone?: () => void; trigger?: "icon"; autoOpen?: boolean; onDismiss?: () => void;
}) {
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [open, setOpen] = useState(autoOpen);
  const [deletePiSessions, setDeletePiSessions] = useState(deletePiSessionsByDefault);
  const { busy, error, setError, run } = useWorkspaceCleanup();
  function close() { setOpen(false); onDismiss?.(); }
  return (
    <>
      {trigger === "icon" ? (
        // 低频且有确认窗口的操作，退成弱化图标，不在每一行喊一遍。
        <Pressable accessibilityRole="button" accessibilityLabel={`归档并清理 ${label}`} hitSlop={6}
          onPress={() => { setError(null); setDeletePiSessions(deletePiSessionsByDefault); setOpen(true); }}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({ width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center",
            backgroundColor: hovered || pressed ? theme.colors.surface2 : "transparent", transform: [{ scale: pressed ? 0.9 : 1 }] })}>
          <Icon name="Archive" size={15} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <ConfirmCleanup open={open} title="归档并清理 Workspace" identity={`${label}\n${workspaceId}`}
        detail="归档 Workspace，并永久删除其中全部 Agent 与时间线，包括未归档的 Agent。保留项目文件。"
        error={error} deletePiSessions={deletePiSessions} busy={busy} theme={theme}
        onDeletePiSessionsChange={setDeletePiSessions} onOpenChange={value => { if (!value) close(); else setOpen(true); }}
        confirmLabel="确认删除" onConfirm={() => { void run({ workspaceId, deletePiSessions }).then(ok => { if (ok) { close(); onDone?.(); } }); }} />
    </>
  );
}

function BatchConfirm({ agents, open, onOpenChange, onDone, theme, styles }: {
  agents: ListedAgent[]; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void; theme: CleanupTheme; styles: Styles;
}) {
  const cleanup = useRpc(cleanupAgentsRpc);
  const toast = useToast();
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [deletePiSessions, setDeletePiSessions] = useState(deletePiSessionsByDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setDeletePiSessions(deletePiSessionsByDefault); } }, [open, deletePiSessionsByDefault]);
  const live = agents.filter(a => !isFinishedAgent(a)).length;
  async function confirm() {
    setBusy(true); setError(null);
    try {
      const result = await cleanup({ agentIds: agents.map(a => a.id), deletePiSessions, confirmation: "DELETE" });
      const removed = result.piSessions.filter(s => s.status === "trashed" || s.status === "quarantined").length;
      toast.show(`已删除 ${result.deletedAgentIds.length} 个 Agent${removed ? `，移除 ${removed} 个 Pi session` : ""}。`, { variant: "success" });
      for (const warning of result.warnings) toast.show(warning, { variant: "warning" });
      onOpenChange(false); onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  const shown = agents.slice(0, 8);
  return (
    <ConfirmCleanup open={open} onOpenChange={onOpenChange} title={`删除 ${agents.length} 个 Agent`} identity={`${agents.length} 个 Agent 与全部时间线`}
      detail="永久删除，无法撤销。不删除项目文件，也不归档 Workspace。" error={error} busy={busy} theme={theme}
      deletePiSessions={deletePiSessions} onDeletePiSessionsChange={setDeletePiSessions} confirmLabel={`删除 ${agents.length} 个`} onConfirm={() => void confirm()}>
      <ScrollView style={styles.scopeList}>
        {shown.map(agent => (
          <Text key={agent.id} style={styles.scopeItem} numberOfLines={1}>
            {agent.title ?? "未命名 Agent"}<Text style={styles.scopeMeta}>  {agentStatusText(agent)} · {agent.id.slice(0, 8)}</Text>
          </Text>
        ))}
        {agents.length > shown.length ? <Text style={styles.scopeMeta}>{`另外 ${agents.length - shown.length} 个`}</Text> : null}
      </ScrollView>
      {live ? <Text style={styles.warning}>{`其中 ${live} 个还没结束，删除时会先中断它们。`}</Text> : null}
    </ConfirmCleanup>
  );
}

// 活跃 Workspace 的宿主汇总状态和 diff 只在目录接口里有，注册表里没有。
async function listLiveWorkspaces(paseo: ReturnType<typeof usePaseo>): Promise<ReadonlyMap<string, LiveWorkspace>> {
  const result = new Map<string, LiveWorkspace>();
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const workspace of page.entries) result.set(workspace.id, { status: workspace.status ?? null, diffStat: workspace.diffStat ?? null });
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return result;
}

export function MainSurface({ theme, layout, navigation }: PluginScreenProps) {
  const paseo = usePaseo();
  const getCatalog = useRpc(catalogRpc);
  const { expandProjectsByDefault } = useCleanupDefaults();
  const cleanupTheme: CleanupTheme = { colors: theme.colors, compact: layout.compact };
  const colors = theme.colors;
  const styles = useStyles(colors, layout.compact);
  const [agents, setAgents] = useState<ListedAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [liveWorkspaces, setLiveWorkspaces] = useState<ReadonlyMap<string, LiveWorkspace>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<CleanupIntent | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // 深链意图：挂载时取走待处理意图，挂载期间订阅新意图（页面已开着时 ⌘K 也能弹）。
  useEffect(() => {
    const pending = takePendingCleanup();
    if (pending) setIntent(pending);
    return onCleanupRequested(setIntent);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextAgents, nextCatalog, nextLive] = await Promise.all([listAllAgents(paseo), getCatalog({}), listLiveWorkspaces(paseo)]);
      const merged = new Map(nextAgents.map(a => [a.id, a]));
      for (const agent of nextCatalog.archivedAgents ?? []) if (!merged.has(agent.id)) merged.set(agent.id, agent);
      const all = [...merged.values()];
      setAgents(all);
      // 已归档且没有 Agent 的 Workspace 在 Paseo 里已经看不到，这里也不再列出。
      setWorkspaces(nextCatalog.workspaces.filter(w => !w.archivedAt || all.some(a => a.workspaceId === w.workspaceId)));
      setProjects(nextCatalog.projects);
      setLiveWorkspaces(nextLive);
      setSelected(prev => new Set([...prev].filter(id => merged.has(id))));
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [paseo, getCatalog]);
  useEffect(() => void refresh(), [refresh]);
  // 会话开始、结束、等待授权、归档时自动重读；流式输出不触发。
  useLiveDirectory(paseo, () => void refresh());

  const counts = useMemo<Record<Filter, number>>(() => {
    const live = agents.filter(a => !a.archivedAt).map(agentState);
    return {
      all: agents.length,
      attention: live.filter(needsAttention).length,
      running: live.filter(isRunningState).length,
      cleanable: agents.filter(a => isFinishedAgent(a)).length,
    };
  }, [agents]);
  const activeFilter = filter;

  const projectOf = useCallback((agent: ListedAgent) => workspaces.find(w => w.workspaceId === agent.workspaceId)?.projectId ?? "unknown", [workspaces]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agents.filter(agent => {
      if (activeFilter === "cleanable" && !isFinishedAgent(agent)) return false;
      if (activeFilter === "attention" && (agent.archivedAt || !needsAttention(agentState(agent)))) return false;
      if (activeFilter === "running" && (agent.archivedAt || !isRunningState(agentState(agent)))) return false;
      if (!needle) return true;
      const workspace = workspaces.find(w => w.workspaceId === agent.workspaceId);
      const project = projects.find(p => p.projectId === workspace?.projectId);
      return [agent.title, agent.id, workspace?.title, workspace?.displayName, project?.customName, project?.displayName]
        .some(value => value?.toLowerCase().includes(needle));
    });
  }, [agents, workspaces, projects, activeFilter, query]);

  const groups = useMemo(() => {
    const byProject = new Map<string, ListedAgent[]>();
    for (const agent of visible) byProject.set(projectOf(agent), [...(byProject.get(projectOf(agent)) ?? []), agent]);
    return [...byProject.entries()].map(([projectId, list]) => {
      const workspaceIds = [...new Set(list.map(a => a.workspaceId ?? `agent:${a.id}`))];
      const latest = (id: string) => workspaceActivity(workspaces.find(w => w.workspaceId === id), list.filter(a => (a.workspaceId ?? `agent:${a.id}`) === id));
      workspaceIds.sort((a, b) => latest(b) - latest(a) || a.localeCompare(b));
      return { projectId, project: projects.find(p => p.projectId === projectId), agents: list, workspaceIds, latest: Math.max(0, ...list.map(activityTime)) };
    }).sort((a, b) => b.latest - a.latest || a.projectId.localeCompare(b.projectId));
  }, [visible, workspaces, projects, projectOf]);

  // 「等你处理」只在默认视图出现；筛选或搜索时下面的列表已经只剩这些行。
  const waiting = useMemo(() => activeFilter !== "all" || query.trim() ? [] : agents
    .filter(a => !a.archivedAt && needsAttention(agentState(a)))
    .sort((a, b) => (Date.parse(a.attentionTimestamp ?? "") || activityTime(a)) - (Date.parse(b.attentionTimestamp ?? "") || activityTime(b))), [agents, activeFilter, query]);
  const placeOf = (agent: ListedAgent) => {
    const workspace = workspaces.find(w => w.workspaceId === agent.workspaceId);
    const project = projects.find(p => p.projectId === workspace?.projectId);
    return [project?.customName || project?.displayName, workspace?.title || workspace?.displayName].filter(Boolean).join(" · ");
  };
  const isCollapsed = (projectId: string) => collapsed.has(projectId) !== !expandProjectsByDefault;
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = (ids: string[], on: boolean) => setSelected(prev => { const next = new Set(prev); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });
  const selectedAgents = agents.filter(a => selected.has(a.id));
  const hasSelection = selectedAgents.length > 0;

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: hasSelection ? 96 : 32 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* 页面名由宿主顶栏显示，这里不再重复大标题，只留统计。 */}
            <Text style={styles.stats}>
              {loaded ? `${agents.length} 个 Agent · ${new Set(agents.map(a => a.workspaceId).filter(Boolean)).size} 个 Workspace · ${counts.cleanable} 个可清理` : error ? "读取失败" : "正在读取…"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="刷新" disabled={loading} hitSlop={6} onPress={() => void refresh()}
            style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", opacity: loading ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
            {loading && loaded ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : <Icon name="RefreshCw" size={16} color={colors.foregroundMuted} />}
          </Pressable>
        </View>

        <View style={styles.toolbar}>
          <Segment value={activeFilter} onChange={setFilter} counts={counts} styles={styles} colors={colors} />
          <View style={styles.search}>
            <Icon name="Search" size={14} color={colors.foregroundMuted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="搜索标题、Workspace 或 Project" placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel="搜索" style={styles.searchInput} autoCorrect={false} autoCapitalize="none" />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setQuery("")}>
              <Icon name="X" size={14} color={colors.foregroundMuted} />
            </Pressable> : null}
          </View>
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loaded && loading ? <ActivityIndicator color={colors.foregroundMuted} /> : null}

        {loaded && groups.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="BrushCleaning" size={20} color={colors.foregroundMuted} />
            <Text style={styles.emptyText}>
              {query ? `没有匹配「${query.trim()}」的 Agent`
                : activeFilter === "cleanable" ? "没有已归档或已关闭的 Agent，暂时不用清理"
                : activeFilter === "attention" ? "没有等你处理的 Agent"
                : activeFilter === "running" ? "没有正在运行的 Agent" : "没有 Agent"}
            </Text>
            <View>
              {query ? <ActionButton label="清空搜索" size="small" theme={cleanupTheme} onPress={() => setQuery("")} />
                : activeFilter !== "all" && agents.length ? <ActionButton label={`查看全部 ${agents.length} 个`} size="small" theme={cleanupTheme} onPress={() => setFilter("all")} /> : null}
            </View>
          </View>
        ) : null}

        {waiting.length ? <AttentionPanel agents={waiting} labelOf={placeOf} navigation={navigation} styles={styles} colors={colors} /> : null}

        <View style={styles.list}>
          {groups.map(group => (
            <ProjectSection key={group.projectId} label={group.project?.customName || group.project?.displayName || "未关联 Project"}
              workspaceIds={group.workspaceIds} agents={group.agents}
              collapsed={isCollapsed(group.projectId)} onCollapse={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(group.projectId)) next.delete(group.projectId); else next.add(group.projectId); return next; })}
              styles={styles} colors={colors}>
              {group.workspaceIds.map((id, index) => (
                <WorkspaceGroup key={id} first={index === 0} workspaceId={id.startsWith("agent:") ? undefined : id} workspace={workspaces.find(w => w.workspaceId === id)}
                  live={liveWorkspaces.get(id)} navigation={navigation}
                  projectRoot={group.project?.rootPath} agents={group.agents.filter(a => (a.workspaceId ?? `agent:${a.id}`) === id)}
                  selected={selected} onToggle={toggle} onToggleAll={toggleAll} onDone={() => void refresh()} styles={styles} colors={colors} theme={cleanupTheme} />
              ))}
            </ProjectSection>
          ))}
        </View>
      </ScrollView>

      {hasSelection ? (
        <View style={styles.bar}>
          <View style={styles.barInner} accessibilityRole="toolbar">
            <Text style={styles.barText} numberOfLines={1}>{`已选 ${selectedAgents.length} 个 Agent`}</Text>
            <ActionButton label="取消" size="small" theme={cleanupTheme} onPress={() => setSelected(new Set())} />
            <ActionButton label={`删除 ${selectedAgents.length} 个`} size="small" danger theme={cleanupTheme} onPress={() => setConfirming(true)} />
          </View>
        </View>
      ) : null}

      <BatchConfirm agents={selectedAgents} open={confirming} onOpenChange={setConfirming} onDone={() => { setSelected(new Set()); void refresh(); }} theme={cleanupTheme} styles={styles} />

      {loaded && intent?.kind === "workspace" ? (
        <WorkspaceCleanupAction key={`w:${intent.id}`} workspaceId={intent.id} theme={cleanupTheme} autoOpen
          label={workspaces.find(w => w.workspaceId === intent.id)?.title ?? workspaces.find(w => w.workspaceId === intent.id)?.displayName ?? intent.id}
          onDismiss={() => setIntent(null)} onDone={() => void refresh()} />
      ) : null}
      {loaded && intent?.kind === "agent" ? (
        <AgentCleanupAction key={`a:${intent.id}`} agentId={intent.id} label={agents.find(a => a.id === intent.id)?.title ?? intent.id} theme={cleanupTheme}
          onDone={() => { setIntent(null); void refresh(); }} />
      ) : null}
    </View>
  );
}

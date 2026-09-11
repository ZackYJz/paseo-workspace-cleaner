import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { activityLabel, activityTime, workspaceActivity, type ActivityRecord } from "../shared/activity";
import { catalogRpc, jobPhaseLabel, previewRpc, startMaintenanceRpc, terminalJob, type MaintenanceJob, type WorkspaceRecord, type ProjectRecord } from "../shared/maintenance";
import { onCleanupRequested, takePendingCleanup, type CleanupIntent } from "./cleanup-intent";
import { ConfirmCleanup, useAgentCleanup, useWorkspaceCleanup } from "./cleanup-dialog";
import { ActionButton, agentStatusText, listAllAgents, useCleanupStyles, type CleanupTheme, type ListedAgent } from "./cleanup-ui";
import { useCleanupDefaults } from "./defaults";

function AgentCleanupAction({
  agentId,
  label,
  theme,
  onDone,
  buttonLabel = "删除",
  danger = false,
  hideButton = false,
  autoOpen = false,
  onDismiss,
}: {
  agentId: string;
  label: string;
  theme: CleanupTheme;
  onDone?: () => void;
  buttonLabel?: string;
  danger?: boolean;
  hideButton?: boolean;
  autoOpen?: boolean;
  onDismiss?: () => void;
}) {
  const styles = useCleanupStyles(theme);
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [open, setOpen] = useState(false);
  const [deletePiSession, setDeletePiSession] = useState(deletePiSessionsByDefault);
  const { busy, error, setError, run } = useAgentCleanup();

  function openDialog() {
    setError(null);
    setDeletePiSession(deletePiSessionsByDefault);
    setOpen(true);
  }
  function closeDialog() {
    setOpen(false);
    onDismiss?.();
  }
  // 深链意图：组件因意图而挂载时直接弹出确认窗口。
  useEffect(() => {
    if (autoOpen) openDialog();
  }, [autoOpen]);

  async function confirm() {
    const ok = await run({ agentId, deletePiSession });
    if (ok) {
      closeDialog();
      onDone?.();
    }
  }

  return (
    <>
      {hideButton ? null : <ActionButton label={buttonLabel} icon="Trash2" danger={danger} theme={theme} onPress={openDialog} />}
      <ConfirmCleanup
        open={open}
        title="删除 Agent"
        identity={`${label}\n${agentId}`}
        detail="永久删除此 Agent 的 Paseo 记录与时间线，无法撤销。不删除项目文件。"
        error={error}
        deletePiSessions={deletePiSession}
        busy={busy}
        theme={theme}
        onDeletePiSessionsChange={setDeletePiSession}
        onOpenChange={(value) => { setOpen(value); if (!value) onDismiss?.(); }}
        confirmLabel="确认删除"
        onConfirm={() => { void confirm(); }}
      >
        <Text style={styles.muted}>删除 Paseo 记录与时间线，不删除项目文件。</Text>
      </ConfirmCleanup>
    </>
  );
}

function WorkspaceCleanupAction({
  workspaceId,
  label,
  theme,
  onDone,
  buttonLabel = "清理全部",
  danger = false,
  hideButton = false,
  autoOpen = false,
  onDismiss,
}: {
  workspaceId: string;
  label: string;
  theme: CleanupTheme;
  onDone?: () => void;
  buttonLabel?: string;
  danger?: boolean;
  hideButton?: boolean;
  autoOpen?: boolean;
  onDismiss?: () => void;
}) {
  const styles = useCleanupStyles(theme);
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [open, setOpen] = useState(false);
  const [deletePiSessions, setDeletePiSessions] = useState(deletePiSessionsByDefault);
  const { busy, error, setError, run } = useWorkspaceCleanup();

  function openDialog() {
    setError(null);
    setDeletePiSessions(deletePiSessionsByDefault);
    setOpen(true);
  }
  function closeDialog() {
    setOpen(false);
    onDismiss?.();
  }
  useEffect(() => {
    if (autoOpen) openDialog();
  }, [autoOpen]);

  async function confirm() {
    const ok = await run({ workspaceId, deletePiSessions });
    if (ok) {
      closeDialog();
      onDone?.();
    }
  }

  return (
    <>
      {hideButton ? null : <ActionButton label={buttonLabel} icon={danger ? "Trash2" : undefined} danger={danger} theme={theme} onPress={openDialog} />}
      <ConfirmCleanup
        open={open}
        title="清理 Workspace"
        identity={`${label}\n${workspaceId}`}
        detail="归档 Workspace，并永久删除其中全部 Agent 与时间线，包括未归档的 Agent。保留项目文件和 Workspace 归档记录。"
        error={error}
        deletePiSessions={deletePiSessions}
        busy={busy}
        theme={theme}
        onDeletePiSessionsChange={setDeletePiSessions}
        onOpenChange={(value) => { setOpen(value); if (!value) onDismiss?.(); }}
        confirmLabel="确认删除"
        onConfirm={() => { void confirm(); }}
      >
        <Text style={styles.muted}>归档记录可在 Cleaner 中使用停机删除移除。</Text>
      </ConfirmCleanup>
    </>
  );
}

function JobSummary({ job, theme }: { job: MaintenanceJob; theme: CleanupTheme }) {
  const styles = useCleanupStyles(theme);
  const [expanded, setExpanded] = useState(false);
  const problem = job.phase === "failed" || job.phase === "needs-recovery";
  const status = jobPhaseLabel(job);
  return <View style={[styles.section, { gap: 4 }]}>
    <View style={styles.spread}>
      <Text style={[styles.grow, problem ? styles.danger : styles.muted]}>
        {status} · {job.deletedWorkspaceIds.length} 个 Workspace / {job.deletedAgentIds.length} 个 Agent{job.warnings.length ? ` · ${job.warnings.length} 条提醒` : ""}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "收起清理详情" : "查看清理详情"}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.button}>
        <Text style={styles.buttonText}>{expanded ? "收起" : "详情"}</Text>
      </Pressable>
    </View>
    {problem || !terminalJob(job) || expanded ? <Text selectable style={problem ? styles.danger : styles.subtitle}>{job.detail}</Text> : null}
    {expanded ? <View style={{ gap: 4 }}>
      <Text style={styles.muted}>更新于 {job.updatedAt}</Text>
      <Text selectable style={styles.muted}>备份与结果：{job.backupDirectory}</Text>
      {job.warnings.map((warning, i) => <Text key={i} style={styles.muted}>{warning}</Text>)}
    </View> : null}
  </View>;
}

function OfflineCleanupCard({ workspaces, agents, job, loading, loadError, theme, onDone }: {
  workspaces: WorkspaceRecord[]; agents: ListedAgent[]; job: MaintenanceJob | null;
  loading: boolean; loadError: string | null; theme: CleanupTheme; onDone: () => void;
}) {
  const preview = useRpc(previewRpc);
  const start = useRpc(startMaintenanceRpc);
  const styles = useCleanupStyles(theme);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof preview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = workspaces.filter(w => w.archivedAt);
  const targetAgents = agents.filter(a => archived.some(w => w.workspaceId === a.workspaceId));
  const maintenancePending = job && (!terminalJob(job) || job.phase === "needs-recovery");
  async function show() {
    setOpen(true); setError(null); setPlan(null);
    try { setPlan(await preview({})); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  async function confirm() {
    if (!plan || plan.blockers.length) return;
    setBusy(true); setError(null);
    try {
      await start({ token: plan.token, confirmation: "DELETE" });
      setOpen(false); onDone();
    } catch (error) {
      setError(`${error instanceof Error ? error.message : String(error)}。若连接已断开，重连后先查看顶部任务结果，不要重复提交。`);
      onDone();
    } finally { setBusy(false); }
  }
  return <View style={[styles.inset, { padding: theme.compact ? 16 : 20, gap: 12, borderWidth: 1, borderColor: theme.colors.border }]}>
    <View style={[styles.spread, theme.compact ? { flexDirection: "column", alignItems: "stretch" } : {}]}>
    <View style={[styles.grow, { gap: 4 }]}>
      <Text style={styles.heading}>统一停机清理</Text>
      <Text style={styles.subtitle}>删除已归档 Workspace、其下 Agent 与 Pi session。保留项目文件；daemon 短暂断开后自动恢复。</Text>
      <Text style={styles.muted}>{loading ? "正在读取归档范围…" : loadError ? "读取失败，请刷新后重试" : archived.length ? `${archived.length} 个已归档 Workspace · ${targetAgents.length} 个 Agent` : "没有已归档的 Workspace，无需停机。"}</Text>
    </View>
    <ActionButton label="预览停机清理" theme={theme} disabled={busy || loading || Boolean(loadError) || !archived.length || Boolean(maintenancePending)} onPress={() => void show()} />
    </View>
    {job ? <JobSummary key={job.id} job={job} theme={theme} /> : null}
    <ConfirmCleanup open={open} title="统一停机删除" identity={plan ? `${plan.workspaceIds.length} 个 Workspace · ${plan.agentIds.length} 个 Agent · ${plan.piSessionCount} 个关联 Pi session` : "正在检查删除范围…"}
      detail={`清理以下所有已归档 Workspace，包括其中${plan ? ` ${plan.unarchivedAgentCount} 个` : ""}未单独归档的 Agent。时间线永久删除，备份仅含注册表和元数据。所有客户端会暂时断开，请勿同时发送任务。`}
      error={error ?? (plan?.blockers.length ? plan.blockers.join("\n") : null)}
      theme={theme} busy={busy} confirmDisabled={!plan || plan.blockers.length > 0} confirmLabel="确认删除"
      deletePiSessions includePiSessions onDeletePiSessionsChange={() => {}} onOpenChange={setOpen} onConfirm={confirm}>
      {plan ? <View style={{ gap: 12 }}>
        {plan.workspaces.map(workspace => <View key={workspace.workspaceId} style={{ gap: 2 }}>
          <Text style={styles.heading}>{workspace.projectName} / {workspace.name}</Text>
          <Text style={styles.muted}>{workspace.agentCount} 个 Agent</Text>
          <Text selectable style={styles.muted}>{workspace.workspaceId}</Text>
          <Text selectable style={styles.muted}>{workspace.cwd}</Text>
        </View>)}
      </View> : !error ? <ActivityIndicator color={theme.colors.accent} /> : null}
    </ConfirmCleanup>
  </View>;
}

function WorkspaceGroup({ agents, workspace, workspaceId, projectRoot, theme, onDone }: {
  agents: ListedAgent[];
  workspace?: WorkspaceRecord;
  workspaceId?: string;
  projectRoot?: string;
  theme: CleanupTheme;
  onDone: () => void;
}) {
  const first = agents[0];
  const styles = useCleanupStyles(theme);
  // An unavailable (often archived) workspace must not borrow an agent's title as its name.
  const label = workspace?.title || workspace?.displayName || (workspaceId ? "Workspace" : "未关联 Workspace");
  return (
    <View style={styles.section} accessibilityLabel={`Workspace ${workspaceId ?? first?.id}`}>
      <View style={styles.sectionHeader}>
        <View style={styles.spread}>
          <View style={styles.grow}>
            <Text style={styles.workspaceHeading}>{label}</Text>
            <View style={styles.meta}>
              <Text style={styles.muted}>{agents.length} 个 Agent</Text>
              {workspace?.archivedAt ? <Text style={styles.muted}>已归档</Text> : null}
              <Text style={styles.muted}>{activityLabel(workspaceActivity(workspace, agents))}</Text>
            </View>
          </View>
          {!workspace?.archivedAt && workspaceId ? <WorkspaceCleanupAction workspaceId={workspaceId} label={label} theme={theme} onDone={onDone} /> : null}
        </View>
        {(workspace?.cwd ?? first?.cwd) !== projectRoot ? <Text selectable style={styles.muted}>{workspace?.cwd ?? first?.cwd}</Text> : null}
        {!workspace ? <Text selectable style={styles.muted}>{workspaceId ?? first?.id}</Text> : null}
      </View>
      {[...agents].sort((a, b) => activityTime(b) - activityTime(a) || a.id.localeCompare(b.id)).map((agent) => (
        <View key={agent.id} style={[styles.spread, styles.agentRow]}>
          <View style={[styles.grow, { gap: 2 }]}>
            <Text style={styles.text}>{agent.title ?? "未命名 Agent"}</Text>
            <View style={styles.meta}>
              <Text style={styles.muted}>{agent.provider}</Text>
              <Text style={styles.muted}>{agentStatusText(agent)}</Text>
              <Text selectable style={styles.muted}>{agent.id.slice(0, 8)}</Text>
            </View>
          </View>
          <AgentCleanupAction agentId={agent.id} label={agent.title ?? agent.id} theme={theme} onDone={onDone} />
        </View>
      ))}
    </View>
  );
}

function ProjectGroup({ project, workspaces, agents, theme, onDone }: {
  project?: ProjectRecord; workspaces: WorkspaceRecord[]; agents: ListedAgent[]; theme: CleanupTheme; onDone: () => void;
}) {
  const { expandProjectsByDefault } = useCleanupDefaults();
  const [expanded, setExpanded] = useState(expandProjectsByDefault);
  const [focused, setFocused] = useState(false);
  const styles = useCleanupStyles(theme);
  useEffect(() => setExpanded(expandProjectsByDefault), [expandProjectsByDefault]);
  const label = project?.customName || project?.displayName || "未关联 Project";
  const ids = [...new Set([...workspaces.map(w => w.workspaceId), ...agents.map(a => a.workspaceId ?? `agent:${a.id}`)])];
  const activity = (id: string) => workspaceActivity(workspaces.find(w => w.workspaceId === id), agents.filter(a => (a.workspaceId ?? `agent:${a.id}`) === id));
  ids.sort((a, b) => activity(b) - activity(a) || a.localeCompare(b));
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "折叠" : "展开"} ${label}`}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.spread, { minHeight: 52, padding: 10, borderRadius: 6, backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1, borderWidth: 1, borderColor: focused ? theme.colors.accent : "transparent" }]}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
      <View style={styles.grow}>
        <Text style={styles.projectHeading}>{label}</Text>
        <Text style={styles.muted}>{ids.length} 个 Workspace · {agents.length} 个 Agent</Text>
      </View>
    </Pressable>
    {expanded ? <View style={{ gap: 20, paddingLeft: theme.compact ? 8 : 26 }}>
      {project ? <Text selectable style={styles.muted}>{project.rootPath}</Text> : null}
      {ids.map(id => <WorkspaceGroup key={id} workspaceId={id.startsWith("agent:") ? undefined : id}
        workspace={workspaces.find(w => w.workspaceId === id)} projectRoot={project?.rootPath} agents={agents.filter(a => (a.workspaceId ?? `agent:${a.id}`) === id)} theme={theme} onDone={onDone} />)}
    </View> : null}
  </View>;
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const getCatalog = useRpc(catalogRpc);
  const cleanupTheme = { colors: theme.colors, compact: layout.compact };
  const styles = useCleanupStyles(cleanupTheme);
  const [agents, setAgents] = useState<ListedAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [job, setJob] = useState<MaintenanceJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<CleanupIntent | null>(null);

  // 深链意图：挂载时取走待处理意图，挂载期间订阅新意图（主页已开着时 ⌘K 也能弹）。
  useEffect(() => {
    const pending = takePendingCleanup();
    if (pending) setIntent(pending);
    return onCleanupRequested(setIntent);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextAgents, nextCatalog] = await Promise.all([listAllAgents(paseo), getCatalog({})]);
      const merged = new Map(nextAgents.map(a => [a.id, a]));
      for (const agent of nextCatalog.archivedAgents ?? []) if (!merged.has(agent.id)) merged.set(agent.id, agent);
      setAgents([...merged.values()]);
      setWorkspaces(nextCatalog.workspaces);
      setProjects(nextCatalog.projects);
      setJob(nextCatalog.job);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [paseo, getCatalog]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (!job || terminalJob(job)) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [job, refresh]);

  const groups = useMemo(() => {
    const projectFor = (agent: ListedAgent) => workspaces.find(w => w.workspaceId === agent.workspaceId)?.projectId ?? "unknown";
    const ids = [...new Set([...workspaces.map(w => w.projectId), ...agents.map(projectFor)])];
    return ids.map(id => ({ id, project: projects.find(p => p.projectId === id), workspaces: workspaces.filter(w => w.projectId === id), agents: agents.filter(a => projectFor(a) === id) }))
      .sort((a, b) => Math.max(0, ...b.agents.map(activityTime), ...b.workspaces.map(w => activityTime({ createdAt: w.createdAt }))) - Math.max(0, ...a.agents.map(activityTime), ...a.workspaces.map(w => activityTime({ createdAt: w.createdAt }))) || a.id.localeCompare(b.id));
  }, [agents, workspaces, projects]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ gap: 8 }}>
        <View style={styles.spread}>
          <View style={styles.grow}>
            <Text style={styles.title}>会话清理</Text>
            <Text style={styles.muted}>{loading ? "正在读取会话…" : error ? "会话读取失败" : `${groups.length} 个 Project · ${agents.length} 个 Agent`}</Text>
          </View>
          <ActionButton label={loading ? "读取中" : "刷新"} icon="RefreshCw" theme={cleanupTheme} disabled={loading} onPress={() => void refresh()} />
        </View>
          <Text style={styles.subtitle}>
            按 Project 分组，Workspace 按最近活跃排序。删除 Agent 无需停机。
          </Text>
      </View>
      <OfflineCleanupCard workspaces={workspaces} agents={agents} job={job} loading={loading} loadError={error} theme={cleanupTheme} onDone={() => void refresh()} />
      {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
      {!loading && !error && groups.length === 0 ? (
        <Text style={styles.muted}>没有可清理的 Agent。</Text>
      ) : null}
      {groups.map(group => (
        <ProjectGroup key={group.id} {...group} theme={cleanupTheme} onDone={() => void refresh()} />
      ))}
      {!loading && intent?.kind === "workspace" ? (
        <WorkspaceCleanupAction
          workspaceId={intent.id}
          label={workspaces.find(workspace => workspace.workspaceId === intent.id)?.displayName ?? intent.id}
          theme={cleanupTheme}
          buttonLabel="清理全部 Agent"
          danger
          hideButton
          autoOpen
          onDismiss={() => setIntent(null)}
          onDone={() => setIntent(null)}
        />
      ) : null}
      {!loading && intent?.kind === "agent" ? (
        <AgentCleanupAction
          agentId={intent.id}
          label={agents.find(agent => agent.id === intent.id)?.title ?? intent.id}
          theme={cleanupTheme}
          buttonLabel="删除 Agent"
          danger
          hideButton
          autoOpen
          onDismiss={() => setIntent(null)}
          onDone={() => setIntent(null)}
        />
      ) : null}
    </ScrollView>
  );
}

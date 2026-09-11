import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { cleanupAgentRpc, cleanupWorkspaceRpc, isFinishedAgent } from "../shared/cleanup";
import { useCleanupDefaults } from "./defaults";
import { ActionButton, agentStatusText, listAllAgents, useCleanupStyles } from "./cleanup-ui";
import type { CleanupTheme, ListedAgent } from "./cleanup-ui";

// 清理 RPC 的调用语义只在这里定义一次：busy、错误、toast 文案统一处理，
// 主页行内弹窗与 header 浮层共用，避免两处各写一遍成功与失败分支。
export function useWorkspaceCleanup() {
  const cleanup = useRpc(cleanupWorkspaceRpc);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(input: { workspaceId: string; deletePiSessions: boolean; onlyFinished?: boolean }): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await cleanup({ workspaceId: input.workspaceId, deletePiSessions: input.deletePiSessions, onlyFinished: input.onlyFinished ?? false, confirmation: "DELETE" });
      const deleted = result.deletedAgentIds.length;
      const removed = result.piSessions.filter(session => session.status === "trashed" || session.status === "quarantined").length;
      toast.show(
        deleted > 0 ? `已清理 ${deleted} 个 Agent${removed > 0 ? `，移除 ${removed} 个 Pi session` : ""}。` : "没有可清理的 Agent。",
        { variant: deleted > 0 ? "success" : "info" },
      );
      for (const warning of result.warnings) toast.show(warning, { variant: "warning" });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function useAgentCleanup() {
  const cleanup = useRpc(cleanupAgentRpc);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(input: { agentId: string; deletePiSession: boolean }): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await cleanup({ agentId: input.agentId, deletePiSession: input.deletePiSession, confirmation: "DELETE" });
      const session = result.piSessions[0];
      const removed = session?.status === "trashed" || session?.status === "quarantined";
      toast.show(`Agent 已删除${removed ? "，Pi session 已移除" : ""}。`, { variant: "success" });
      for (const warning of result.warnings) toast.show(warning, { variant: "warning" });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function PiSessionSwitch({ value, onChange, theme, disabled = false }: {
  value: boolean;
  onChange: (value: boolean) => void;
  theme: CleanupTheme;
  disabled?: boolean;
}) {
  const styles = useCleanupStyles(theme);
  return (
    <View style={styles.spread}>
      <View style={styles.grow}>
        <Text style={styles.text}>同时移除 Pi session</Text>
        <Text style={styles.muted}>会删除 ~/.pi/agent/sessions 下的对应记录。</Text>
      </View>
      <Switch accessibilityLabel="同时移除 Pi session" value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

// 清理范围卡片：把「将永久删除什么」提为浮层与弹窗里唯一的视觉锚点。
export function CleanupScopeCard({ scope, note, loading, loadError, theme, children }: {
  scope: string;
  note: string;
  loading: boolean;
  loadError: string | null;
  theme: CleanupTheme;
  children?: React.ReactNode;
}) {
  const styles = useCleanupStyles(theme);
  return (
    <View style={styles.scopeCard} accessibilityLabel="清理范围">
      <View style={styles.scopeLabelRow}>
        <Icon name="Trash2" size={13} color={theme.colors.statusDanger} />
        <Text style={styles.scopeLabel}>将永久删除</Text>
      </View>
      {loadError
        ? <Text accessibilityRole="alert" style={styles.danger}>{loadError}</Text>
        : loading
          ? <Text style={styles.muted}>正在读取清理范围…</Text>
          : <Text style={styles.text}>{scope}</Text>}
      {children}
      <Text style={styles.muted}>{note}</Text>
    </View>
  );
}

export function WorkspaceScopeList({ agents, loading, loadError, theme }: {
  agents: ListedAgent[] | null;
  loading: boolean;
  loadError: string | null;
  theme: CleanupTheme;
}) {
  const styles = useCleanupStyles(theme);
  return (
    <CleanupScopeCard
      theme={theme}
      loading={loading}
      loadError={loadError}
      scope={agents?.length ? `${agents.length} 个 Agent 与全部时间线` : "此 Workspace 下没有 Agent"}
      note="「仅已关闭」只删除上面标注为已归档或已关闭的行。保留项目文件与 Workspace 归档记录。"
    >
      {agents?.length ? (
        <View style={{ gap: 6 }}>
          {agents.map(agent => (
            <View key={agent.id} style={styles.scopeRow}>
              <Text style={styles.text} numberOfLines={1}>{agent.title ?? "未命名 Agent"}</Text>
              <Text style={styles.metaLine}>{agentStatusText(agent)} · {agent.provider} · {agent.id.slice(0, 8)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </CleanupScopeCard>
  );
}

export function ConfirmCleanup({
  open,
  onOpenChange,
  title,
  identity,
  detail,
  deletePiSessions,
  onDeletePiSessionsChange,
  busy,
  error,
  confirmLabel,
  confirmDisabled = false,
  includePiSessions = false,
  onConfirm,
  theme,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  identity: string;
  detail: string;
  deletePiSessions?: boolean;
  onDeletePiSessionsChange?: (value: boolean) => void;
  busy: boolean;
  error: string | null;
  confirmLabel: string;
  confirmDisabled?: boolean;
  includePiSessions?: boolean;
  onConfirm: () => void;
  theme: CleanupTheme;
  children?: React.ReactNode;
}) {
  const styles = useCleanupStyles(theme);
  return (
    <Modal
      title={title}
      icon={<Icon name="Trash2" size={18} color={theme.colors.foreground} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        <View style={styles.inset}>
          <Text style={styles.heading}>{identity}</Text>
          <Text style={styles.muted}>{detail}</Text>
        </View>
        {children}
        {deletePiSessions !== undefined && onDeletePiSessionsChange && !includePiSessions
          ? <PiSessionSwitch value={deletePiSessions} onChange={onDeletePiSessionsChange} disabled={busy} theme={theme} />
          : null}
        {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
        <View style={styles.meta}>
          <ActionButton label="取消" theme={theme} disabled={busy} onPress={() => onOpenChange(false)} />
          <ActionButton label={busy ? "正在删除…" : confirmLabel} theme={theme} danger disabled={busy || confirmDisabled} onPress={onConfirm} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

// header 垃圾桶按钮的浮层内容：宽屏是锚定卡片，窄屏是底部 sheet。
// 宿主负责锚定、滚动与内边距，这里只渲染正文。
export function WorkspaceCleanupSheet(props: PluginButtonContentProps) {
  if (props.context !== "workspace") return null;
  return <WorkspaceCleanupSheetBody theme={props.theme} layout={props.layout} workspaceId={props.workspaceId} close={props.close} />;
}

function WorkspaceCleanupSheetBody({ theme, layout, workspaceId, close }: {
  theme: PluginButtonContentProps["theme"];
  layout: PluginButtonContentProps["layout"];
  workspaceId: string;
  close: () => void;
}) {
  const workspace = useWorkspace(workspaceId, ({ name, directory }) => ({ name, directory }));
  const paseo = usePaseo();
  const cleanupTheme: CleanupTheme = { colors: theme.colors, compact: layout.compact };
  const styles = useCleanupStyles(cleanupTheme);
  const { deletePiSessionsByDefault } = useCleanupDefaults();
  const [deletePiSessions, setDeletePiSessions] = useState(deletePiSessionsByDefault);
  const [agents, setAgents] = useState<ListedAgent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, run } = useWorkspaceCleanup();
  const loading = agents === null && !loadError;
  const finishedCount = agents?.filter(agent => isFinishedAgent(agent)).length ?? 0;

  useEffect(() => {
    let cancelled = false;
    setAgents(null);
    setLoadError(null);
    listAllAgents(paseo)
      .then(all => { if (!cancelled) setAgents(all.filter(agent => agent.workspaceId === workspaceId)); })
      .catch(fetchError => { if (!cancelled) setLoadError(fetchError instanceof Error ? fetchError.message : String(fetchError)); });
    return () => { cancelled = true; };
  }, [paseo, workspaceId]);

  async function confirm(onlyFinished: boolean) {
    const ok = await run({ workspaceId, deletePiSessions, onlyFinished });
    if (ok) close();
  }

  return (
    <View style={styles.dialogBody}>
      <View style={styles.dialogHeader}>
        <Text style={styles.identity}>{workspace?.name ?? workspaceId}</Text>
        {workspace?.directory ? <Text style={styles.metaLine}>{workspace.directory}</Text> : null}
        <Text style={styles.idText}>{workspaceId}</Text>
      </View>
      <View style={styles.sheetActions}>
        <ActionButton label="取消" size="small" theme={cleanupTheme} onPress={close} />
        <ActionButton
          label={finishedCount > 0 ? `仅已关闭（${finishedCount}）` : "仅已关闭"}
          size="small"
          theme={cleanupTheme}
          danger
          disabled={busy || loading || finishedCount === 0}
          onPress={() => { void confirm(true); }}
        />
        <ActionButton label="清理全部" size="small" theme={cleanupTheme} danger disabled={busy || loading} onPress={() => { void confirm(false); }} />
      </View>
      <WorkspaceScopeList agents={agents} loading={loading} loadError={loadError} theme={cleanupTheme} />
      <PiSessionSwitch value={deletePiSessions} onChange={setDeletePiSessions} theme={cleanupTheme} />
      {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
    </View>
  );
}

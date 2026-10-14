import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
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
        <Text style={styles.text}>同时移除 Pi 会话文件</Text>
        <Text style={styles.muted}>移到系统废纸篓，可以找回。仍被其他 Agent 使用的会保留。</Text>
      </View>
      <Switch accessibilityLabel="同时移除 Pi 会话文件" value={value} disabled={disabled} onValueChange={onChange} />
    </View>
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
          <ActionButton label={busy ? "正在删除…" : confirmLabel} theme={theme} destructive disabled={busy || confirmDisabled} onPress={onConfirm} />
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

type Scope = "all" | "finished";

/** /Users/name/x 和 /home/name/x 显示成 ~/x；客户端拿不到 HOME，只认这两种常见前缀。 */
function shortPath(directory: string): string {
  return directory.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
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
  const [scope, setScope] = useState<Scope>("all");
  const { busy, error, run } = useWorkspaceCleanup();
  const loading = agents === null && !loadError;

  useEffect(() => {
    let cancelled = false;
    setAgents(null);
    setLoadError(null);
    listAllAgents(paseo)
      .then(all => { if (!cancelled) setAgents(all.filter(agent => agent.workspaceId === workspaceId)); })
      .catch(fetchError => { if (!cancelled) setLoadError(fetchError instanceof Error ? fetchError.message : String(fetchError)); });
    return () => { cancelled = true; };
  }, [paseo, workspaceId]);

  const all = agents ?? [];
  const finished = all.filter(agent => isFinishedAgent(agent));
  // 没有已结束的 Agent 时「仅已关闭」没有意义，退回「全部」，免得确认按钮停在 0。
  const effectiveScope: Scope = scope === "finished" && finished.length === 0 ? "all" : scope;
  const targets = effectiveScope === "finished" ? finished : all;
  const willDelete = (agent: ListedAgent) => effectiveScope === "all" || isFinishedAgent(agent);
  const running = targets.filter(agent => agent.status === "running" || agent.status === "initializing").length;
  const hasPi = targets.some(agent => agent.provider === "pi");

  async function confirm() {
    const ok = await run({ workspaceId, deletePiSessions: hasPi && deletePiSessions, onlyFinished: effectiveScope === "finished" });
    if (ok) close();
  }

  const option = (value: Scope, label: string, hint: string, count: number, first: boolean) => {
    const selected = effectiveScope === value;
    const disabled = busy || loading || count === 0;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={`${label}，${count} 个`}
        accessibilityState={{ checked: selected, disabled }}
        // react-native-web 不会把 accessibilityState.checked 映射成 aria-checked，网页端读屏要靠这个。
        aria-checked={selected}
        disabled={disabled}
        onPress={() => setScope(value)}
        style={({ pressed }) => [styles.option, !first && styles.optionDivider, selected && styles.optionSelected, pressed && { opacity: 0.7 }, disabled && !selected && { opacity: 0.45 }]}
      >
        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
        <View style={styles.optionText}>
          <Text style={styles.text}>{label}</Text>
          <Text style={styles.metaLine}>{hint}</Text>
        </View>
        <Text style={styles.optionCount}>{loading ? "…" : count}</Text>
      </Pressable>
    );
  };

  let scopeBody: React.ReactNode;
  if (loadError) scopeBody = <Text accessibilityRole="alert" style={styles.danger}>{loadError}</Text>;
  else if (loading) scopeBody = <Text style={styles.muted}>正在读取清理范围…</Text>;
  else if (all.length === 0) scopeBody = <Text style={styles.muted}>此 Workspace 下没有 Agent。</Text>;
  else {
    scopeBody = (
      <>
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="删除范围">
          {option("all", "全部 Agent", "包括空闲和运行中的", all.length, true)}
          {option("finished", "仅已关闭或已归档", "空闲和运行中的保留", finished.length, false)}
        </View>
        <ScrollView style={styles.agentList} accessibilityLabel="Agent 列表">
          {all.map(agent => {
            const deleted = willDelete(agent);
            return (
              <View key={agent.id} style={[styles.agentItem, !deleted && styles.agentItemKept]}>
                <View style={[styles.bullet, !deleted && styles.bulletKept]} />
                <View style={styles.grow}>
                  <Text style={styles.text} numberOfLines={2}>{agent.title ?? "未命名 Agent"}</Text>
                  <Text style={styles.metaLine}>{agentStatusText(agent)} · {agent.provider}</Text>
                </View>
                {deleted ? null : <Text style={styles.keptTag}>保留</Text>}
              </View>
            );
          })}
        </ScrollView>
        {running > 0 ? <Text style={styles.warningText}>{`其中 ${running} 个正在运行，删除时会先中断。`}</Text> : null}
      </>
    );
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.eyebrowRow}>
          <Icon name="Trash2" size={12} color={theme.colors.statusDanger} />
          <Text style={styles.eyebrow}>清理 Workspace</Text>
        </View>
        <Text style={styles.identity} numberOfLines={2}>{workspace?.name ?? "Workspace"}</Text>
        {workspace?.directory ? <Text style={styles.metaLine} numberOfLines={1}>{shortPath(workspace.directory)}</Text> : null}
      </View>

      {scopeBody}

      {hasPi ? <PiSessionSwitch value={deletePiSessions} onChange={setDeletePiSessions} disabled={busy} theme={cleanupTheme} /> : null}

      <View style={styles.footer}>
        {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
        <Text style={styles.muted}>Agent 记录和时间线会永久删除，无法撤销。项目文件和 Workspace 记录保留。</Text>
        <View style={styles.footerActions}>
          <ActionButton label="取消" size="small" theme={cleanupTheme} disabled={busy} onPress={close} />
          <ActionButton
            label={busy ? "正在删除…" : `删除 ${targets.length} 个 Agent`}
            size="small"
            destructive
            theme={cleanupTheme}
            disabled={busy || loading || targets.length === 0}
            onPress={() => { void confirm(); }}
          />
        </View>
      </View>
    </View>
  );
}

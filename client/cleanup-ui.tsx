import { useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import type { PluginSurfaceProps, usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ActivityRecord } from "../shared/activity";

const PAGE_SIZE = 200;

// Agent 状态文案的唯一来源，列表、浮层与确认窗口共用。
export function agentStatusText(agent: { status?: string | null; archivedAt?: string | null }): string {
  if (agent.archivedAt) return "已归档";
  return agent.status === "closed" ? "已关闭" : agent.status === "idle" ? "空闲" : agent.status === "running" ? "运行中" : agent.status ?? "未知";
}

export type PaseoApi = ReturnType<typeof usePaseo>;
export type ListedAgent = Pick<Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"], "id" | "title" | "provider" | "cwd" | "workspaceId" | "status" | "archivedAt"> & ActivityRecord & {
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
};

export interface CleanupTheme {
  colors: PluginSurfaceProps["theme"]["colors"];
  compact: boolean;
}

export function useCleanupStyles({ colors, compact }: CleanupTheme) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: colors.surface0 },
      content: {
        padding: compact ? 16 : 24,
        gap: 24,
        maxWidth: 1040,
        width: "100%" as const,
        alignSelf: "center" as const,
      },
      title: {
        color: colors.foreground,
        fontSize: 20,
        lineHeight: 28,
        fontWeight: "600" as const,
      },
      subtitle: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 22 },
      // 身份 > 正文 > 元信息 > 机器 ID，四档字阶不重叠。
      identity: { color: colors.foreground, fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
      metaLine: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
      idText: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
      dialogBody: { gap: 12 },
      sheetActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      dialogHeader: { gap: 4 },
      scopeCard: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: compact ? 12 : 14, gap: 8 },
      scopeLabelRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      scopeLabel: { color: colors.statusDanger, fontSize: 12, lineHeight: 18, fontWeight: "600" as const },
      scopeRow: { gap: 2, paddingTop: 2 },
      section: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 12, gap: 4 },
      sectionHeader: { paddingBottom: 8, gap: 6 },
      agentRow: { paddingVertical: 8, paddingLeft: compact ? 12 : 20, gap: 4 },
      projectHeading: { color: colors.foreground, fontSize: 17, lineHeight: 24, fontWeight: "600" as const },
      workspaceHeading: { color: colors.foreground, fontSize: 15, lineHeight: 22, fontWeight: "600" as const },
      meta: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      inset: { backgroundColor: colors.surface1, borderRadius: 8, padding: 12, gap: 6 },
      spread: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      grow: { flex: 1, minWidth: 0 },
      heading: { color: colors.foreground, fontSize: 14, lineHeight: 22, fontWeight: "600" as const },
      text: { color: colors.foreground, fontSize: 14, lineHeight: 22 },
      muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 20 },
      danger: { color: colors.statusDanger, fontSize: 13, lineHeight: 22 },
      button: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: "transparent",
        minHeight: 40,
        minWidth: 40,
        paddingHorizontal: 10,
        flexDirection: "row" as const,
        gap: 6,
        justifyContent: "center" as const,
        alignItems: "center" as const,
        alignSelf: "flex-start" as const,
      },
      buttonDanger: {
        borderColor: colors.statusDanger,
        paddingHorizontal: 16,
      },
      buttonSmall: { minHeight: 32, paddingHorizontal: 10 },
      buttonDangerSmall: { paddingHorizontal: 12 },
      buttonTextSmall: { fontSize: 12 },
      buttonText: { color: colors.foreground, fontSize: 13, fontWeight: "500" as const },
      // 最终确认用实心红：整个浮层里只有它会真的删东西，视觉上必须独一份。
      // 文字取 surface0：深色主题下是深字压浅红，浅色主题下是白字压深红，都不写死颜色。
      buttonDestructive: { backgroundColor: colors.statusDanger, borderColor: colors.statusDanger, paddingHorizontal: 14 },
      buttonTextDestructive: { color: colors.surface0, fontWeight: "600" as const },

      // header 清理浮层
      sheet: { gap: compact ? 14 : 16 },
      sheetHead: { gap: 3 },
      eyebrowRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      eyebrow: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
      sectionLabel: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
      options: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" as const },
      option: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
      optionDivider: { borderTopWidth: 1, borderTopColor: colors.border },
      optionSelected: { backgroundColor: colors.surface1 },
      radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.foregroundMuted, alignItems: "center" as const, justifyContent: "center" as const },
      radioOn: { borderColor: colors.statusDanger },
      radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.statusDanger },
      optionText: { flex: 1, gap: 1 },
      optionCount: { color: colors.foregroundMuted, fontSize: 13, fontVariant: ["tabular-nums" as const] },
      agentList: { maxHeight: 220 },
      agentItem: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8, paddingVertical: 6 },
      agentItemKept: { opacity: 0.45 },
      bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.statusDanger },
      bulletKept: { backgroundColor: colors.foregroundMuted },
      keptTag: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 20 },
      warningText: { color: colors.statusWarning, fontSize: 12, lineHeight: 18 },
      footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 10 },
      footerActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, alignItems: "center" as const, gap: 8 },
    }),
    [colors, compact],
  );
}

export function ActionButton({ label, icon, theme, onPress, disabled = false, danger = false, destructive = false, size = "normal" }: {
  label: string;
  icon?: string;
  theme: CleanupTheme;
  onPress: () => void;
  disabled?: boolean;
  /** 红色描边：会进入删除流程的入口。 */
  danger?: boolean;
  /** 实心红：真正执行删除的最终确认，一个界面只放一个。 */
  destructive?: boolean;
  size?: "normal" | "small";
}) {
  const styles = useCleanupStyles(theme);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        size === "small" && styles.buttonSmall,
        danger && styles.buttonDanger,
        danger && size === "small" && styles.buttonDangerSmall,
        destructive && styles.buttonDestructive,
        focused && { borderColor: theme.colors.accent },
        pressed && !destructive && { backgroundColor: theme.colors.surface2 },
        pressed && { transform: [{ scale: 0.98 }] },
        disabled && { opacity: 0.45 },
      ]}
    >
      {icon ? <Icon name={icon} size={size === "small" ? 13 : 15} color={destructive ? theme.colors.surface0 : theme.colors.foregroundMuted} /> : null}
      <Text style={[styles.buttonText, size === "small" && styles.buttonTextSmall, danger && { color: theme.colors.statusDanger }, destructive && styles.buttonTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

export async function listAllAgents(paseo: PaseoApi): Promise<ListedAgent[]> {
  const agents: ListedAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return agents;
}

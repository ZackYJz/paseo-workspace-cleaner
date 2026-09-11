import type { RpcOutput } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { jobPhaseLabel } from "../shared/maintenance";
import { cleanerSettings, diagnosticsRpc } from "../shared/settings";

type Diagnostics = RpcOutput<typeof diagnosticsRpc>;

function jobSummary(job: Diagnostics["job"]): string {
  if (!job) return "尚未执行过停机清理";
  // 备份目录是异常恢复的入口，诊断页不隐藏它。
  return `${jobPhaseLabel(job)} · ${job.deletedWorkspaceIds.length} 个 Workspace / ${job.deletedAgentIds.length} 个 Agent · ${job.updatedAt} · 备份 ${job.backupDirectory}`;
}

export function CleanerSettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(cleanerSettings);
  const diagnostics = useRpc(diagnosticsRpc);
  const [report, setReport] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await diagnostics({}));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [diagnostics]);
  useEffect(() => { void refresh(); }, [refresh]);

  const gateIssues = report?.gateIssues ?? [];
  const diagnosticsSection = (
    <SettingsSection title="停机删除可用性" info="只读检查，不会删除或停止任何内容">
      <SettingsCard>
        <SettingsRow
          label="Paseo CLI"
          hint={report ? `${report.cliFromEnvironment ? "来自环境变量" : "来自 PATH"}：${report.cliPath}` : loading ? "正在检查…" : "尚未读取"}
          error={error}
        />
        <SettingsRow
          label="daemon 版本"
          hint={report ? `${report.daemonVersion ?? "未知"} · 停机删除仅在 ${report.supportedMinor}.x 上验证` : loading ? "正在检查…" : "尚未读取"}
          error={gateIssues.length ? gateIssues.join("；") : null}
        />
        <SettingsRow label="上次停机任务" hint={report ? jobSummary(report.job) : loading ? "正在读取…" : "尚未读取"} />
        <SettingsAction label="重新检查" actionLabel={loading ? "检查中…" : "立即检查"} disabled={loading} onPress={() => void refresh()} />
      </SettingsCard>
    </SettingsSection>
  );

  if (settings.status === "loading") {
    return (
      <Text style={{ color: theme.colors.foregroundMuted, padding: layout.compact ? 16 : 24 }}>
        正在读取设置…
      </Text>
    );
  }

  if (settings.status !== "ready") {
    // 存储值无效或读取失败时不把默认值当作已保存值展示，只给恢复入口。
    const invalid = settings.status === "invalid";
    return (
      <>
        <SettingsSection title="清理默认值">
          <SettingsCard>
            <SettingsRow
              label="设置暂时不可用"
              error={settings.error}
              hint={invalid
                ? "已保存的值不符合当前版本。重置只影响这些界面默认值，不会删除任何 Workspace、Agent 或 session。"
                : "读取失败，可重新读取。"}
            />
            <SettingsAction
              label="恢复方式"
              actionLabel={invalid ? "重置为默认值" : "重新读取"}
              onPress={() => void (invalid ? settings.reset() : settings.reload())}
            />
          </SettingsCard>
        </SettingsSection>
        {diagnosticsSection}
      </>
    );
  }

  return (
    <>
      <SettingsSection title="清理默认值">
        <SettingsCard>
          <SettingsSwitch
            label="默认同时移除 Pi session"
            hint="关闭后，删除确认框默认不移除 Pi session；仍可在确认时单独打开。共享 session 始终自动保留。"
            value={settings.values.deletePiSessionsByDefault}
            disabled={settings.saving}
            error={settings.saveError}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, deletePiSessionsByDefault: value }, settings.revision)
            }
          />
          <SettingsSwitch
            label="默认展开 Project 列表"
            hint="关闭后，清理页的 Project 分组初始为折叠状态。"
            value={settings.values.expandProjectsByDefault}
            disabled={settings.saving}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, expandProjectsByDefault: value }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
      {diagnosticsSection}
    </>
  );
}

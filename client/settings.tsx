import type { RpcOutput } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { cleanerSettings, diagnosticsRpc, GRACE_DAY_OPTIONS } from "../shared/settings";

type Diagnostics = RpcOutput<typeof diagnosticsRpc>;

const GRACE_OPTIONS = GRACE_DAY_OPTIONS.map(days => ({ label: `${days} 天`, value: String(days) }));

function lastRunSummary(run: Diagnostics["lastAutoRun"]): string {
  // 结果只保存在插件进程内存里，插件重载或 daemon 重启后清空。
  if (!run) return "插件本次启动后还没有运行过";
  if (run.error) return `${run.at} · 失败`;
  return `${run.at} · ${run.workspaceCount} 个 Workspace / ${run.deletedAgentCount} 个 Agent / ${run.removedPiSessionCount} 个 Pi session`;
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

  // 宽限期改了之后到期范围也会变，跟着重读。
  const graceDays = settings.status === "ready" ? settings.values.autoCleanupGraceDays : null;
  useEffect(() => { void refresh(); }, [graceDays, refresh]);

  const pending = loading ? "正在检查…" : "尚未读取";
  const diagnosticsSection = (
    <SettingsSection title="状态" info="只读检查，不会删除任何内容">
      <SettingsCard>
        <SettingsRow
          label="已满宽限期"
          hint={report ? `${report.due.workspaceCount} 个已归档 Workspace · ${report.due.agentCount} 个 Agent（开关打开后的下一轮会清理）` : pending}
          error={error}
        />
        <SettingsRow
          label="上次自动清理"
          hint={report ? lastRunSummary(report.lastAutoRun) : pending}
          error={report?.lastAutoRun?.error ?? null}
        />
        <SettingsRow
          label="Paseo CLI"
          hint={report ? `${report.cliFromEnvironment ? "来自环境变量" : "来自 PATH"}：${report.cliPath}` : pending}
        />
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
      <SettingsSection title="自动清理" info="在 daemon 上运行，每小时检查一次">
        <SettingsCard>
          <SettingsSwitch
            label="自动清理已归档的 Workspace"
            hint="Workspace 归档满宽限期后，永久删除其下已归档、已关闭的 Agent 与时间线。是否同时移除 Pi session 跟随上面的默认值。保留项目文件。"
            value={settings.values.autoCleanupArchived}
            disabled={settings.saving}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, autoCleanupArchived: value }, settings.revision)
            }
          />
          <SettingsSelect
            label="宽限期"
            hint="归档后这段时间内仍可在 Paseo 里 Restore，期满才会被清理。"
            value={String(settings.values.autoCleanupGraceDays)}
            options={GRACE_OPTIONS}
            disabled={settings.saving}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, autoCleanupGraceDays: Number(value) }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
      {diagnosticsSection}
    </>
  );
}

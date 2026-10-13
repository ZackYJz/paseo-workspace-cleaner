import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { diagnosticsRpc, type CleanerPreferences } from "../shared/settings";
import type { AutoCleaner } from "./auto-cleanup";
import { cliPath } from "./registry";

// 只读：不删除、不写任何文件。到期数量与开关无关，打开前也能先看会清掉多少。
export async function readDiagnostics(
  _input: RpcInput<typeof diagnosticsRpc>,
  { paseo }: PluginHandlerContext,
  auto: AutoCleaner,
  prefs: CleanerPreferences,
): Promise<RpcOutput<typeof diagnosticsRpc>> {
  return {
    cliPath: cliPath(),
    cliFromEnvironment: Boolean(process.env.PASEO_CLI_PATH?.trim() || process.env.PASEO_CLI),
    due: await auto.due(paseo, prefs.autoCleanupGraceDays),
    lastAutoRun: auto.lastRun,
  };
}

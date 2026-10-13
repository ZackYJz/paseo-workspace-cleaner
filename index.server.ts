import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { AUTO_INTERVAL_MS, AutoCleaner } from "./server/auto-cleanup";
import { cleanupAgent, cleanupAgents, cleanupWorkspace, readCatalog } from "./server/cleanup";
import { readDiagnostics } from "./server/diagnostics";
import { catalogRpc } from "./shared/catalog";
import { cleanupAgentRpc, cleanupAgentsRpc, cleanupWorkspaceRpc } from "./shared/cleanup";
import { cleanerSettings, diagnosticsRpc, type CleanerPreferences } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  // 内置持久化需要 server 入口注册 settings 文档。
  const settings = server.registerSettings(cleanerSettings);
  const readPrefs = async (): Promise<CleanerPreferences | null> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : null;
  };
  const auto = new AutoCleaner({ readSettings: readPrefs, log: line => console.log(line) });

  server.handle(cleanupAgentRpc, (input, context) => { auto.trigger(context.paseo); return cleanupAgent(input, context); });
  server.handle(cleanupAgentsRpc, (input, context) => { auto.trigger(context.paseo); return cleanupAgents(input, context); });
  server.handle(cleanupWorkspaceRpc, (input, context) => { auto.trigger(context.paseo); return cleanupWorkspace(input, context); });
  server.handle(catalogRpc, (input, context) => { auto.trigger(context.paseo); return readCatalog(input, context); });
  server.handle(diagnosticsRpc, async (input, context) => {
    auto.trigger(context.paseo);
    return readDiagnostics(input, context, auto, (await readPrefs()) ?? cleanerSettings.schema.parse({}));
  });

  // 生命周期事件既是拿到 daemon 会话的入口，也是节流后的触发信号；不 await，避开回调超时。
  const wake = (_event: unknown, { paseo }: PluginHookContext) => { void auto.trigger(paseo); };
  const off = [
    server.on("workspace.archived", wake),
    server.on("workspace.created", wake),
    server.on("agent.created", wake),
    server.on("agent.turn_ended", wake),
  ];
  // 开关刚打开时立即检查一轮，不等下一个小时。
  const offSettings = settings.subscribe(state => {
    if (state.status === "ready" && state.values.autoCleanupArchived) void auto.trigger(undefined, { force: true });
  });
  const timer = setInterval(() => { void auto.trigger(); }, AUTO_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    offSettings();
    for (const remove of off) remove();
    auto.stop();
  };
}

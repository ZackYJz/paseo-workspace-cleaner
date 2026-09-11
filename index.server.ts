import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cleanupAgent, cleanupWorkspace } from "./server/cleanup";
import { readDiagnostics } from "./server/diagnostics";
import { readCatalog, previewMaintenance, startMaintenance } from "./server/maintenance";
import { cleanupAgentRpc, cleanupWorkspaceRpc } from "./shared/cleanup";
import { catalogRpc, previewRpc, startMaintenanceRpc } from "./shared/maintenance";
import { cleanerSettings, diagnosticsRpc } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  // 内置持久化需要 server 入口注册 settings 文档。
  server.registerSettings(cleanerSettings);
  server.handle(cleanupAgentRpc, cleanupAgent);
  server.handle(cleanupWorkspaceRpc, cleanupWorkspace);
  server.handle(catalogRpc, readCatalog);
  server.handle(previewRpc, previewMaintenance);
  server.handle(startMaintenanceRpc, startMaintenance);
  server.handle(diagnosticsRpc, readDiagnostics);
  return () => {};
}

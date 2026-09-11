import type { PluginClientContext } from "@getpaseo/plugin/client";
import { requestCleanup } from "./client/cleanup-intent";
import { contributeHeaderButtons } from "./client/header-buttons";
import { MainSurface } from "./client/main";
import { CleanerSettings } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  client.addSurface("main", MainSurface);
  client.addSidebarItem({
    id: "main",
    title: "Workspace Cleaner",
    icon: "Trash2",
    surface: "main",
  });
  // 命令回调起不了浮层：先存意图再打开主页，由主页消费意图弹出确认窗口。
  client.addCommandCenterItem({
    id: "open-workspace-cleanup",
    title: "清理当前 Workspace",
    icon: "Trash2",
    context: "workspace",
    onSelect({ openSurface, workspace }) {
      requestCleanup({ kind: "workspace", id: workspace.id });
      openSurface("main");
    },
  });
  client.addCommandCenterItem({
    id: "open-agent-cleanup",
    title: "删除当前 Agent",
    icon: "Trash2",
    context: "agent",
    onSelect({ openSurface, agent }) {
      requestCleanup({ kind: "agent", id: agent.id });
      openSurface("main");
    },
  });
  client.addSettingsScreen({
    id: "preferences",
    title: "清理设置",
    icon: "Trash2",
    Component: CleanerSettings,
  });
  client.addSlashCommand({
    name: "clean",
    description: "弹出当前 Workspace 的清理确认",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openSurface, workspace }) {
      requestCleanup({ kind: "workspace", id: workspace.id });
      openSurface("main");
    },
  });
  // header 按钮返回 { update, remove } 句柄，需要在清理时显式移除。
  const removeHeaderButtons = contributeHeaderButtons(client);
  return () => {
    removeHeaderButtons();
  };
}

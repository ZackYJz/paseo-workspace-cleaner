import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { requestCleanup } from "./client/cleanup-intent";
import { contributeHeaderButtons } from "./client/header-buttons";
import { MainSurface } from "./client/main";
import { CleanerSettings } from "./client/settings";

function CleanerSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="BrushCleaning" active={currentScreen?.screenId === "main"} onPress={() => openScreen({ screenId: "main" })} />;
}

export default function contribute(client: PluginClientContext) {
  // 页面与侧栏项沿用旧 ID "main"，已保存的链接仍能打开。
  client.addScreen({ id: "main", title: "清理", Component: MainSurface });
  client.addSidebarHeaderItem({ id: "main", title: "清理", Component: CleanerSidebarItem });
  // 命令回调起不了浮层：先存意图再打开主页，由主页消费意图弹出确认窗口。
  client.addCommandCenterItem({
    id: "open-workspace-cleanup",
    title: "清理当前 Workspace",
    icon: "Trash2",
    context: "workspace",
    onSelect({ openScreen, workspace }) {
      requestCleanup({ kind: "workspace", id: workspace.id });
      openScreen({ screenId: "main" });
    },
  });
  client.addCommandCenterItem({
    id: "open-agent-cleanup",
    title: "删除当前 Agent",
    icon: "Trash2",
    context: "agent",
    onSelect({ openScreen, agent }) {
      requestCleanup({ kind: "agent", id: agent.id });
      openScreen({ screenId: "main" });
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
    onSubmit({ openScreen, workspace }) {
      requestCleanup({ kind: "workspace", id: workspace.id });
      openScreen({ screenId: "main" });
    },
  });
  // header 按钮返回 { update, remove } 句柄，需要在清理时显式移除。
  const removeHeaderButtons = contributeHeaderButtons(client);
  return () => {
    removeHeaderButtons();
  };
}

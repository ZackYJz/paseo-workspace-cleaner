import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// 「已结束」的唯一口径：已归档或已关闭。idle/running 一律不算，
// 服务端筛选与客户端计数共用，避免两处各写一套判定。
export function isFinishedAgent(agent: { archivedAt?: string | null; status?: string | null }): boolean {
  return Boolean(agent.archivedAt) || agent.status === "closed";
}

const piSessionResult = z.object({
  agentId: z.string(),
  sessionId: z.string().nullable(),
  status: z.enum(["skipped", "not-pi", "not-found", "shared", "trashed", "quarantined"]),
  detail: z.string().nullable(),
});

export const cleanupAgentRpc = defineRpc({
  name: "workspace-cleaner.agent.cleanup",
  input: z.object({
    agentId: z.string().min(1),
    deletePiSession: z.boolean(),
    confirmation: z.literal("DELETE"),
  }),
  output: z.object({
    deletedAgentIds: z.array(z.string()),
    piSessions: z.array(piSessionResult),
    warnings: z.array(z.string()),
  }),
});

export const cleanupWorkspaceRpc = defineRpc({
  name: "workspace-cleaner.workspace.cleanup",
  input: z.object({
    workspaceId: z.string().min(1),
    deletePiSessions: z.boolean(),
    // 只清理已归档或已关闭的 Agent，不归档 Workspace，不碰 idle/running。
    onlyFinished: z.boolean().default(false),
    confirmation: z.literal("DELETE"),
  }),
  output: z.object({
    workspaceArchived: z.boolean(),
    deletedAgentIds: z.array(z.string()),
    piSessions: z.array(piSessionResult),
    warnings: z.array(z.string()),
  }),
});

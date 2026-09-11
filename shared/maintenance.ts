import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const workspaceRecord = z.object({
  workspaceId: z.string(), projectId: z.string(), cwd: z.string(),
  displayName: z.string(), title: z.string().nullable().optional(),
  archivedAt: z.string().nullable(),
  createdAt: z.string().optional(), updatedAt: z.string().optional(),
}).passthrough();
export const projectRecord = z.object({
  projectId: z.string(), rootPath: z.string(), displayName: z.string(),
  customName: z.string().nullable().optional(),
}).passthrough();
export type WorkspaceRecord = z.infer<typeof workspaceRecord>;
export type ProjectRecord = z.infer<typeof projectRecord>;
export const maintenanceJob = z.object({
  id: z.string(), phase: z.enum(["queued", "checking", "deleting-agents", "stopping", "purging", "restarting", "completed", "failed", "needs-recovery"]),
  detail: z.string(), updatedAt: z.string(), backupDirectory: z.string(),
  deletedAgentIds: z.array(z.string()), deletedWorkspaceIds: z.array(z.string()),
  warnings: z.array(z.string()),
  workerPid: z.number().optional(),
});
export type MaintenanceJob = z.infer<typeof maintenanceJob>;
export const terminalJob = (job: MaintenanceJob) => ["completed", "failed", "needs-recovery"].includes(job.phase);

// 停机删除会停 daemon 并改写注册表，只在经过验证的 Paseo 次版本线上放行。
// 这是唯一权威值：版本闸门、维护进程连接与设置页诊断都从这里读取。
export const SUPPORTED_PASEO_MINOR = "0.8";

// 任务阶段文案的唯一来源，清理页与设置页共用。
export const jobPhaseLabel = (job: MaintenanceJob) =>
  job.phase === "completed" ? "清理完成"
  : job.phase === "failed" ? "清理未完成"
  : job.phase === "needs-recovery" ? "需要人工恢复"
  : "正在清理";

export const catalogRpc = defineRpc({
  name: "workspace-cleaner.catalog", input: z.object({}),
  output: z.object({ workspaces: z.array(workspaceRecord), projects: z.array(projectRecord), job: maintenanceJob.nullable(),
    archivedAgents: z.array(z.object({ id: z.string(), title: z.string().nullable(), provider: z.string(), cwd: z.string(), workspaceId: z.string().optional(), status: z.literal("closed"), archivedAt: z.string(), updatedAt: z.string().optional(), createdAt: z.string().optional() })).default([]),
  }),
});
export const previewRpc = defineRpc({
  name: "workspace-cleaner.maintenance.preview",
  input: z.object({}).strict(),
  output: z.object({ token: z.string(), workspaceIds: z.array(z.string()), agentIds: z.array(z.string()), blockers: z.array(z.string()),
    unarchivedAgentCount: z.number(), piSessionCount: z.number(),
    workspaces: z.array(z.object({ workspaceId: z.string(), name: z.string(), cwd: z.string(), projectName: z.string(), agentCount: z.number() })),
  }),
});
export const startMaintenanceRpc = defineRpc({
  name: "workspace-cleaner.maintenance.start",
  input: z.object({ token: z.string(), confirmation: z.literal("DELETE") }).strict(),
  output: maintenanceJob,
});

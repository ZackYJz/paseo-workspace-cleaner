import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// 宽限期可选值。归档可以 Restore，删除不能撤销，所以不提供 0 天。
export const GRACE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;

// 界面默认值与自动清理开关。Paseo CLI 路径仍由 daemon 环境变量决定，客户端无法改写。
// 新增字段都有默认值，旧文档按 schema 补齐即可，不需要升 version。
export const cleanerSettings = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    deletePiSessionsByDefault: z.boolean().default(true),
    expandProjectsByDefault: z.boolean().default(true),
    autoCleanupArchived: z.boolean().default(false),
    autoCleanupGraceDays: z.number().int().min(1).max(365).default(7),
  }),
});

export type CleanerPreferences = z.output<typeof cleanerSettings.schema>;

export const autoRunResult = z.object({
  at: z.string(),
  workspaceCount: z.number(),
  deletedAgentCount: z.number(),
  removedPiSessionCount: z.number(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
});
export type AutoRunResult = z.infer<typeof autoRunResult>;

// 只读状态：设置页用它解释 CLI 来源和自动清理的进展，不触发任何删除。
export const diagnosticsRpc = defineRpc({
  name: "workspace-cleaner.diagnostics",
  input: z.object({}).strict(),
  output: z.object({
    cliPath: z.string(),
    cliFromEnvironment: z.boolean(),
    /** 宽限期已满、下一轮自动清理会处理的已归档 Workspace 与 Agent 数（不论开关是否打开）。 */
    due: z.object({ workspaceCount: z.number(), agentCount: z.number() }),
    lastAutoRun: autoRunResult.nullable(),
  }),
});

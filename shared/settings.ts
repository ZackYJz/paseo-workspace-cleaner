import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { maintenanceJob } from "./maintenance";

// 只承载界面默认值：不跨越信任边界。
// Paseo CLI 路径仍由 daemon 环境变量决定，停机闸门仍由 server 侧校验，客户端无法改写。
export const cleanerSettings = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    deletePiSessionsByDefault: z.boolean().default(true),
    expandProjectsByDefault: z.boolean().default(true),
  }),
});

export type CleanerPreferences = z.output<typeof cleanerSettings.schema>;

// 只读诊断：解释「为什么停机删除被拒绝」，避免用户只能靠点击预览去试。
export const diagnosticsRpc = defineRpc({
  name: "workspace-cleaner.diagnostics",
  input: z.object({}).strict(),
  output: z.object({
    cliPath: z.string(),
    cliFromEnvironment: z.boolean(),
    supportedMinor: z.string(),
    daemonVersion: z.string().nullable(),
    gateIssues: z.array(z.string()),
    job: maintenanceJob.nullable(),
  }),
});

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Paseo 注册表行的只读视图。passthrough 保留未声明字段，避免误判为格式变化。
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

export const catalogRpc = defineRpc({
  name: "workspace-cleaner.catalog", input: z.object({}),
  output: z.object({ workspaces: z.array(workspaceRecord), projects: z.array(projectRecord),
    archivedAgents: z.array(z.object({ id: z.string(), title: z.string().nullable(), provider: z.string(), cwd: z.string(), workspaceId: z.string().optional(), status: z.literal("closed"), archivedAt: z.string(), updatedAt: z.string().optional(), createdAt: z.string().optional() })).default([]),
  }),
});

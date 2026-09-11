import { createPaseoClient } from "@getpaseo/client";
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { maintenanceJob, SUPPORTED_PASEO_MINOR } from "../shared/maintenance";
import { catalog, cleanerHome, cliPath, daemonStatus, deletePaseoAgent, jobRoot, makePreview, readRegular, runMaintenance, saveJob, scheduleBlockers, validateDaemon } from "./maintenance";

const exec = promisify(execFile);
// 与版本闸门共用同一来源，避免连接时声明的客户端版本与支持范围失同步。
const appVersion = `${SUPPORTED_PASEO_MINOR}.0`;
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
async function portOpen(listen: string) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(listen.split(":")[1]) });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); error.code === "ECONNREFUSED" ? resolve(false) : reject(error); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("无法确认监听端口已关闭")); });
  });
}
async function main(directory: string) {
  const request = z.object({ home: z.string(), workspaceIds: z.array(z.string()), token: z.string() }).strict()
    .parse(JSON.parse(await readRegular(path.join(directory, "request.json"))));
  if (path.dirname(directory) !== jobRoot(request.home)) throw new Error("维护目录不匹配");
  const job = maintenanceJob.parse(JSON.parse(await readRegular(path.join(directory, "result.json"))));
  if (job.backupDirectory !== directory || await readRegular(path.join(jobRoot(request.home), "maintenance.lock")) !== job.id) throw new Error("任务锁不匹配");
  let client: ReturnType<typeof createPaseoClient> | undefined;
  try {
    // Give the initiating RPC time to acknowledge; all destructive checks happen again below.
    await delay(1500);
    const original = await daemonStatus(request.home);
    validateDaemon(original, request.home);
    const url = `ws://${original.listen}/ws`;
    client = createPaseoClient({ url, appVersion, password: process.env.PASEO_PASSWORD, reconnect: { enabled: false } });
    await client.connect();
    const assertStopped = async () => {
      if (alive(original.pid!) || await portOpen(original.listen)) throw new Error("daemon 尚未停止或已经重新启动，拒绝写注册表");
      try {
        const pid = z.object({ pid: z.number() }).parse(JSON.parse(await readRegular(path.join(request.home, "paseo.pid"))));
        if (alive(pid.pid)) throw new Error("发现其他运行中的 daemon，拒绝写注册表");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    };
    await runMaintenance(request, job, client, {
      check: async () => {
        const current = await daemonStatus(request.home);
        validateDaemon(current, request.home);
        if (current.pid !== original.pid || current.serverId !== original.serverId) throw new Error("daemon 身份已改变");
        const blockers = await scheduleBlockers(request.home);
        if (blockers.length) throw new Error(blockers.join("\n"));
      },
      deleteAgent: id => deletePaseoAgent(id, original.listen),
      stop: async () => {
        await client!.close();
        await exec(cliPath(), ["daemon", "stop", "--home", request.home, "--json"], { timeout: 45_000 });
      },
      assertStopped,
      restart: async () => {
        // If shutdown failed or Desktop already restarted it, verify that daemon instead of spawning another.
        if (await portOpen(original.listen)) {
          if (alive(original.pid!)) throw new Error("原 daemon 仍在运行或退出中，不能确认恢复；请检查状态后处理");
          return;
        }
        await exec(cliPath(), ["daemon", "start", "--home", request.home, "--listen", original.listen, "--no-web-ui", "--json"], {
          timeout: 60_000, env: { ...process.env, PASEO_DESKTOP_MANAGED: "1", PASEO_WEB_UI_ENABLED: "false" },
        });
      },
      verifyRestart: async () => {
        const status = await daemonStatus(request.home);
        validateDaemon(status, request.home);
        if (status.serverId !== original.serverId || status.listen !== original.listen) throw new Error("恢复后的 daemon 身份不匹配");
        const probe = createPaseoClient({ url, appVersion, password: process.env.PASEO_PASSWORD, reconnect: { enabled: false } });
        try { await probe.connect(); await probe.agents.list({ page: { limit: 1 } }); } finally { await probe.close(); }
      },
    }, request.home);
  } catch (error) {
    job.phase = "needs-recovery";
    job.detail = `维护进程异常，保留任务锁：${error instanceof Error ? error.message : String(error)}`;
    await saveJob(job, request.home);
  } finally { await client?.close(); }
}

if (process.argv[2] === "--check") {
  const home = cleanerHome();
  const status = await daemonStatus(home); validateDaemon(status, home);
  const client = createPaseoClient({ url: `ws://${status.listen}/ws`, appVersion, password: process.env.PASEO_PASSWORD, reconnect: { enabled: false } });
  try {
    await client.connect();
    const records = await catalog(home);
    const preview = await makePreview(client, home);
    process.stdout.write(JSON.stringify({ mode: "read-only", projects: records.projects.length, archivedWorkspaces: preview.workspaceIds.length,
      archivedWorkspaceAgents: preview.agentIds.length, blockers: preview.blockers }, null, 2) + "\n");
  } finally { await client.close(); }
} else if (process.argv[2] === "--probe") {
  // Harmless packaging/process-boundary smoke test, no daemon or user files touched.
  await delay(200);
  process.stdout.write("workspace-cleaner-worker-ready\n");
} else {
  await main(path.resolve(process.argv[2] || ""));
}

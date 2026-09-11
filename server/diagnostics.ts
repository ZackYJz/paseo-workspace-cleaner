import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { SUPPORTED_PASEO_MINOR } from "../shared/maintenance";
import { diagnosticsRpc } from "../shared/settings";
import { cleanerHome, cliPath, daemonGateIssues, daemonStatus, latestJob } from "./maintenance";

// 只读：不删除、不停机、不写任何文件。读取 daemon 状态失败时报告原因，
// 而不是让设置页把「读不到」显示成「可用」。
export async function readDiagnostics(
  _input: RpcInput<typeof diagnosticsRpc>,
): Promise<RpcOutput<typeof diagnosticsRpc>> {
  const home = cleanerHome();
  const cliFromEnvironment = Boolean(process.env.PASEO_CLI_PATH?.trim() || process.env.PASEO_CLI);
  let daemonVersion: string | null = null;
  let gateIssues: string[];
  try {
    const status = await daemonStatus(home);
    daemonVersion = status.daemonVersion ?? null;
    gateIssues = daemonGateIssues(status, home);
  } catch (error) {
    gateIssues = [`无法读取 daemon 状态：${error instanceof Error ? error.message : String(error)}`];
  }
  return {
    cliPath: cliPath(),
    cliFromEnvironment,
    supportedMinor: SUPPORTED_PASEO_MINOR,
    daemonVersion,
    gateIssues,
    job: await latestJob(home),
  };
}

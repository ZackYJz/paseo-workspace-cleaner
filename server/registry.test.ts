import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
const inspect = vi.hoisted(() => ({ output: {} as Record<string, unknown>, calls: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, result: unknown) => void) => {
    inspect.calls(args); callback(null, { stdout: JSON.stringify(inspect.output), stderr: "" });
  },
}));
import { cleanupBusy, withCleanupLock } from "./cleanup";
import { supplementArchivedAgents } from "./registry";
let home: string;
beforeEach(async () => {
  inspect.calls.mockClear();
  home = await mkdtemp(path.join(tmpdir(), "paseo-archived-safety-"));
  await mkdir(path.join(home, "agents/cwd"), { recursive: true });
  await writeFile(path.join(home, "paseo.pid"), JSON.stringify({ listen: "127.0.0.1:1234" }));
  await writeFile(path.join(home, "agents/cwd/a.json"), JSON.stringify({ id: "a", provider: "pi", cwd: "/tmp/cwd", lastStatus: "closed", archivedAt: "2026-09-01" }));
  inspect.output = { Id: "a", Cwd: "/tmp/cwd", Status: "closed", Archived: true, PendingPermissions: [] };
});
test("missing archived records require official exact-ID inspection", async () => {
  const result = await supplementArchivedAgents([], home);
  expect(result).toMatchObject([{ id: "a", status: "closed", archivedAt: "2026-09-01", pendingPermissions: [] }]);
  expect(inspect.calls).toHaveBeenCalledWith(["agent", "inspect", "a", "--host", "127.0.0.1:1234", "--json"]);
});
test.each([{ Status: "running" }, { Archived: false }, { PendingPermissions: [{}] }, { Id: "other" }, { Cwd: "/elsewhere" }])("fails closed on unsafe inspection %j", async override => {
  Object.assign(inspect.output, override);
  await expect(supplementArchivedAgents([], home)).rejects.toThrow();
});
test("清理按到达顺序排队，失败也会交出锁", async () => {
  const order: string[] = [];
  let finishFirst!: () => void;
  const first = withCleanupLock(async () => {
    order.push("first:start");
    await new Promise<void>((resolve) => { finishFirst = resolve; });
    order.push("first:end");
  });
  const second = withCleanupLock(async () => { order.push("second"); return "ok"; });
  await Promise.resolve();
  expect(cleanupBusy()).toBe(true);
  expect(order).toEqual(["first:start"]);
  finishFirst();
  await expect(second).resolves.toBe("ok");
  await first;
  expect(order).toEqual(["first:start", "first:end", "second"]);
  expect(cleanupBusy()).toBe(false);

  await expect(withCleanupLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  await expect(withCleanupLock(async () => "released")).resolves.toBe("released");
});

test("排队超过上限就放弃：不执行、给出明确提示，也不卡住后面的请求", async () => {
  vi.useFakeTimers();
  try {
    let finishFirst!: () => void;
    const first = withCleanupLock(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const late = vi.fn(async () => "never");
    const abandoned = withCleanupLock(late, 1000);
    const abandonedResult = expect(abandoned).rejects.toThrow("这次没有删除任何内容");
    await vi.advanceTimersByTimeAsync(1000);
    await abandonedResult;
    const third = withCleanupLock(async () => "third");
    finishFirst();
    await first;
    await expect(third).resolves.toBe("third");
    expect(late).not.toHaveBeenCalled();
    expect(cleanupBusy()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

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
import { supplementArchivedAgents, withCleanupLock } from "./maintenance";
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
test("online cleanup and maintenance use a single exclusive lock", async () => {
  await withCleanupLock(async () => {
    await expect(withCleanupLock(async () => {}, home)).rejects.toThrow("已有清理任务");
  }, home);
  await expect(withCleanupLock(async () => "released", home)).resolves.toBe("released");
});

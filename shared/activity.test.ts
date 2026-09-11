import { expect, test } from "vitest";
import { activityTime, workspaceActivity } from "./activity";

test("activity uses the same updatedAt baseline as Paseo, with a valid creation fallback", () => {
  expect(activityTime({ updatedAt: "2026-09-09", createdAt: "2026-08-01" })).toBe(Date.parse("2026-09-09"));
  expect(activityTime({ updatedAt: "invalid", createdAt: "2026-08-01" })).toBe(Date.parse("2026-08-01"));
  expect(activityTime({})).toBe(0);
});

test("workspace metadata changes do not override its agents' latest activity", () => {
  const workspace = { updatedAt: "2026-09-09", createdAt: "2026-08-01" };
  expect(workspaceActivity(workspace, [{ updatedAt: "2026-09-02" }, { updatedAt: "2026-09-04" }])).toBe(Date.parse("2026-09-04"));
  expect(workspaceActivity(workspace, [])).toBe(Date.parse("2026-08-01"));
  expect(workspaceActivity(undefined, [])).toBe(0);
});

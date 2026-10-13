import { expect, test } from "vitest";
import { activityTime, relativeLabel, workspaceActivity } from "./activity";

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

test("relative labels stay short and fall back to a date after 30 days", () => {
  const now = Date.parse("2026-10-13T08:00:00Z");
  expect(relativeLabel(0, now)).toBe("无活动");
  expect(relativeLabel(now - 20_000, now)).toBe("刚刚");
  expect(relativeLabel(now - 5 * 60_000, now)).toBe("5 分钟前");
  expect(relativeLabel(now - 3 * 3600_000, now)).toBe("3 小时前");
  expect(relativeLabel(now - 2 * 86400_000, now)).toBe("2 天前");
  expect(relativeLabel(Date.parse("2026-08-01T12:00:00Z"), now)).toMatch(/^2026\/8\/1$/);
});

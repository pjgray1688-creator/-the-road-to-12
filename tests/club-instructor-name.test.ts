import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstructorName } from "../lib/club-instructor-name";

test("linked current R12 identity wins over stale class instructor snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", [{ userId: "staff-1", displayName: "Aimee Luisa Morris" }], "Aimee Luisa"), "Aimee Luisa Morris");
});

test("linked identity without a name does not fall back to a stale snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", [{ userId: "staff-1" }], "Keenan"), "Instructor name unavailable");
});

test("unlinked sessions may use their recorded instructor snapshot", () => {
  assert.equal(resolveInstructorName(null, [], "Luke Morris"), "Luke Morris");
});

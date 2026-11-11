import assert from "node:assert/strict";
import test from "node:test";
import { listLinkedInstructorIdentities, resolveInstructorName } from "../lib/club-instructor-name";

test("linked current R12 identity wins over stale class instructor snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", [{ userId: "staff-1", displayName: "Aimee Luisa Morris" }], "Aimee Luisa"), "Aimee Luisa Morris");
});

test("linked identity without a name does not fall back to a stale snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", [{ userId: "staff-1" }], "Keenan"), "Instructor name unavailable");
});

test("missing linked identity does not display an outdated class snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", [], "Keenan"), "Instructor name unavailable");
});

test("unlinked sessions may use their recorded instructor snapshot", () => {
  assert.equal(resolveInstructorName(null, [], "Luke Morris"), "Luke Morris");
});

test("overview and timetable use the current linked scheduling identities first", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return name === "club_list_schedule_staff" ? { data: [{ userId: "staff-1", name: "Aimee Luisa Morris" }], error: null } : { data: [], error: null }; } } as never;
  assert.deepEqual(await listLinkedInstructorIdentities(client, "org"), [{ userId: "staff-1", displayName: "Aimee Luisa Morris" }]);
  assert.deepEqual(calls, ["club_list_schedule_staff"]);
});

test("linked identity lookup falls back to the existing scoped Club identity RPC", async () => {
  const client = { rpc: async (name: string) => name === "club_list_schedule_staff" ? { data: [], error: null } : { data: [{ user_id: "staff-2", display_name: "Luke Morris" }], error: null } } as never;
  assert.deepEqual(await listLinkedInstructorIdentities(client, "org"), [{ userId: "staff-2", displayName: "Luke Morris" }]);
});

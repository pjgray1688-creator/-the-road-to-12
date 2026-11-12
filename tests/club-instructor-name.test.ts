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

test("overview and timetable merge linked schedule and profile identities by user id", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return name === "club_list_schedule_staff" ? { data: [{ userId: "staff-1", name: "Aimee Luisa Morris" }, { userId: "staff-2", name: "Luke" }, { userId: "staff-3", name: "George" }], error: null } : { data: [{ user_id: "staff-1", display_name: "Aimee Morris" }, { user_id: "staff-2", display_name: "Luke Morris" }, { user_id: "staff-3", display_name: "George Smith" }], error: null }; } } as never;
  assert.deepEqual(await listLinkedInstructorIdentities(client, "org"), [
    { userId: "staff-1", displayName: "Aimee Luisa Morris" },
    { userId: "staff-2", displayName: "Luke Morris" },
    { userId: "staff-3", displayName: "George Smith" },
  ]);
  assert.deepEqual(calls, ["club_list_schedule_staff", "club_list_member_identities"]);
});

test("linked identity lookup falls back to the existing scoped Club identity RPC", async () => {
  const client = { rpc: async (name: string) => name === "club_list_schedule_staff" ? { data: [], error: null } : { data: [{ user_id: "staff-2", display_name: "Luke Morris" }], error: null } } as never;
  assert.deepEqual(await listLinkedInstructorIdentities(client, "org"), [{ userId: "staff-2", displayName: "Luke Morris" }]);
});

test("short schedule names use the fuller same-account profile name without merging identities", async () => {
  const client = { rpc: async (name: string) => name === "club_list_schedule_staff"
    ? { data: [{ userId: "luke-account", name: "Luke" }, { userId: "george-account", name: "George" }], error: null }
    : { data: [{ user_id: "luke-account", display_name: "Luke Morris" }, { user_id: "george-account", display_name: "George Smith" }], error: null } } as never;
  const identities = await listLinkedInstructorIdentities(client, "org");
  assert.deepEqual(identities, [
    { userId: "luke-account", displayName: "Luke Morris" },
    { userId: "george-account", displayName: "George Smith" },
  ]);
  assert.equal(resolveInstructorName("luke-account", identities, "Luke George"), "Luke Morris");
  assert.equal(resolveInstructorName("george-account", identities, "Luke George"), "George Smith");
});

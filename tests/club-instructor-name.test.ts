import assert from "node:assert/strict";
import test from "node:test";
import { listLinkedInstructorIdentities, resolveInstructorName } from "../lib/club-instructor-name";

test("a linked profile identity wins over a partial or stale session snapshot", () => {
  assert.equal(resolveInstructorName("staff-1", "assignment-1", [{ userId: "staff-1", displayName: "Aimee Luisa Morris" }], "Aimee"), "Aimee Luisa Morris");
});

test("a linked first-name-only profile is completed from its exact assignment identity", () => {
  assert.equal(resolveInstructorName("keenan-user", "keenan-assignment", [
    { userId: "keenan-user", displayName: "Keenan" },
    { assignmentId: "keenan-assignment", displayName: "Keenan Freer" },
  ], "Keenan"), "Keenan Freer");
});

test("an accepted prepared assignment resolves its linked full profile even when a session host is null", () => {
  const identities = [{ assignmentId: "keenan-assignment", displayName: "Keenan Freer" }];
  assert.equal(resolveInstructorName(null, "keenan-assignment", identities, "Keenan"), "Keenan Freer");
});

test("pending invited instructor uses the referenced prepared assignment without invitation acceptance", () => {
  const identities = [{ assignmentId: "luke-assignment", displayName: "Luke Morris" }];
  assert.equal(resolveInstructorName(null, "luke-assignment", identities, "Luke"), "Luke Morris");
});

test("assignment UUIDs keep Luke Morris and George separate even when snapshots are ambiguous", () => {
  const identities = [
    { assignmentId: "assignment-luke", displayName: "Luke Morris" },
    { assignmentId: "assignment-george", displayName: "George Smith" },
  ];
  assert.equal(resolveInstructorName(null, "assignment-luke", identities, "Luke George"), "Luke Morris");
  assert.equal(resolveInstructorName(null, "assignment-george", identities, "Luke George"), "George Smith");
});

test("unlinked one-word snapshots are not promoted to full names", () => {
  assert.equal(resolveInstructorName(null, null, [], "Luke"), "Instructor name unavailable");
});

test("a linked first name is not shown as a full instructor identity when no surname source exists", () => {
  assert.equal(resolveInstructorName("staff-id", "assignment-id", [
    { userId: "staff-id", displayName: "Keenan" },
    { assignmentId: "assignment-id", displayName: "Keenan" },
  ], "Keenan"), "Instructor name unavailable");
});

test("name lookup merges exact user and prepared-assignment identities from authorised RPC output", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => {
    calls.push(name);
    if (name === "club_list_schedule_staff") return { data: [{ userId: "aimee-id", name: "Aimee" }], error: null };
    if (name === "club_list_member_identities") return { data: [{ user_id: "aimee-id", display_name: "Aimee Luisa" }], error: null };
    return { data: [
      { userId: "aimee-id", name: "Aimee Luisa Morris" },
      { assignmentId: "luke-assignment", name: "Luke Morris" },
      { assignmentId: "george-assignment", name: "George Smith" },
    ], error: null };
  } } as never;
  const identities = await listLinkedInstructorIdentities(client, "org-id");
  assert.deepEqual(identities, [
    { userId: "aimee-id", displayName: "Aimee Luisa Morris" },
    { assignmentId: "luke-assignment", displayName: "Luke Morris" },
    { assignmentId: "george-assignment", displayName: "George Smith" },
  ]);
  assert.deepEqual(calls, ["club_list_schedule_staff", "club_list_member_identities", "club_list_class_instructor_identities"]);
});

test("new class identity RPC is organisation scoped and returns only referenced staff/assignments", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../supabase/migrations/2026-11-13-club-class-instructor-identities.sql", import.meta.url), "utf8");
  assert.match(migration, /s\.organisation_id=p_organisation_id/);
  assert.match(migration, /a\.id=s\.instructor_assignment_id and a\.organisation_id=s\.organisation_id/);
  assert.match(migration, /club_has_active_role\(p_organisation_id,array\['trainer','gym_staff','gym_admin','owner'\]/);
  assert.match(migration, /revoke all on function public\.club_list_class_instructor_identities\(uuid\) from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function public\.club_list_class_instructor_identities\(uuid\) to authenticated/i);
  assert.match(migration, /g\.id=a\.staff_grant_id and g\.organisation_id=a\.organisation_id and g\.status='accepted'/);
  assert.match(migration, /m\.user_id=coalesce\(a\.linked_user_id,g\.accepted_by\)/);
  assert.doesNotMatch(migration, /email|phone|location_ids/i);
});

test("Keenan account-link migration is tightly guarded and does not alter grants or permissions", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../supabase/migrations/2026-11-13-club-instructor-account-link.sql", import.meta.url), "utf8");
  assert.match(migration, /v_assignment_id uuid := 'ddd31b34-8adb-45c9-8bdd-aaf0db046f60'/);
  assert.match(migration, /v_user_id uuid := '97e7b69f-ce77-4256-8f4c-5ed77b4a7e84'/);
  assert.match(migration, /lower\(btrim\(p\.first_name\)\)='keenan'[\s\S]*lower\(btrim\(p\.last_name\)\)='freer'/);
  assert.match(migration, /m\.role='owner' and m\.active/);
  assert.match(migration, /v_account_count <> 1 or v_matched_user_id is distinct from v_user_id/);
  assert.match(migration, /staff_grant_id is null/);
  assert.match(migration, /already linked to another prepared assignment/);
  assert.doesNotMatch(migration, /update public\.club_members|update public\.coach_permissions|insert into public\.club_staff_access_grants/i);
});

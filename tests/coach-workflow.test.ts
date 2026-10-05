import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canPersistProgrammeChanges } from "../lib/coach-permissions";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("Coach workflow keeps programme ownership separate from cover sessions", () => {
  const migration = read("supabase/migrations/2026-09-26-coach-safe-workflow.sql");
  const boundaryMigration = read("supabase/migrations/2026-10-05-coach-organisation-boundary.sql");
  const workspace = read("components/coach-workspace.tsx");
  const clientRoute = read("app/api/coach/clients/[id]/route.ts");
  const sessionRoute = read("app/api/coach/sessions/[id]/route.ts");

  assert.match(migration, /coach_permissions/);
  assert.match(migration, /coach_client_assignments/);
  assert.match(migration, /relationship_type text not null check \(relationship_type in \('primary', 'cover'\)\)/);
  assert.match(migration, /coach_start_session/);
  assert.match(migration, /coach_update_session/);
  assert.match(migration, /Programme design,? .*not editable|programme_id text/si);
  assert.match(migration, /cm\.organisation_id=assignment\.organisation_id/);
  assert.match(migration, /coach_member\.active and coach_member\.role in \('trainer','gym_staff','gym_admin','owner'\)/);
  assert.match(migration, /client_member\.active/);
  assert.match(migration, /user_id=p_coach_user_id and active and role in \('trainer','gym_staff','gym_admin','owner'\)/);
  assert.match(migration, /Client is not an active member of this organisation/);
  assert.match(migration, /programmeOwnerName/);
  assert.match(migration, /coach_start_session\(p_client_user_id uuid, p_idempotency_key text, p_programme_id text default null\)/);
  assert.match(migration, /where l\.organisation_id=assignment\.organisation_id and l\.client_user_id=p_client_user_id and l\.coach_user_id=auth\.uid\(\)/);
  assert.match(migration, /exercise_logs jsonb not null/);
  assert.match(migration, /p_relationship_type='primary' and p_programme_owner_user_id is distinct from p_coach_user_id/);
  assert.match(migration, /primary_assignment\.relationship_type='primary'/);
  assert.match(migration, /primary_assignment\.active/);
  assert.match(migration, /primary_assignment\.programme_owner_user_id=p_programme_owner_user_id/);
  assert.match(migration, /Cover assignment must reference the active primary PT/);
  assert.match(migration, /join public\.coach_client_assignments a on a\.id=l\.assignment_id/);
  assert.match(migration, /a\.organisation_id=l\.organisation_id/);
  assert.match(migration, /a\.active/);
  assert.match(migration, /l\.status='active'/);
  assert.doesNotMatch(migration, /values\(assignment\.organisation_id,assignment\.id,auth\.uid\(\),p_client_user_id,p_idempotency_key,p_programme_id\)/);
  assert.match(workspace, /READ-ONLY PROGRAMME/);
  assert.match(workspace, /Session-scoped/);
  assert.match(workspace, /substitutions/);
  assert.match(workspace, /adaptations/);
  assert.match(sessionRoute, /coach_update_session/);
  assert.match(sessionRoute, /p_exercise_logs/);
  assert.match(workspace, /programmed exercises/);
  assert.match(workspace, /programmeOwnerName/);
  assert.match(workspace, /COACH SESSION RECORDS/);
  assert.match(workspace, /Delivered by you/);
  assert.match(workspace, /setNotes\(""\)/);
  assert.match(workspace, /Load/);
  assert.match(workspace, /RIR/);
  assert.doesNotMatch(workspace, /api\/training-profile/);
  assert.doesNotMatch(workspace, /programmeId/);
  assert.doesNotMatch(sessionRoute, /programmeId/);
  assert.match(boundaryMigration, /'organisationId', a\.organisation_id/);
  assert.match(boundaryMigration, /'assignmentId', a\.id/);
  assert.match(boundaryMigration, /coach_get_client\(p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid\)/);
  assert.match(boundaryMigration, /a\.organisation_id=p_organisation_id/);
  assert.match(boundaryMigration, /a\.id=p_assignment_id/);
  assert.match(boundaryMigration, /coach_start_session\(p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid/);
  assert.match(boundaryMigration, /l\.assignment_id=assignment\.id and l\.organisation_id=assignment\.organisation_id/);
  assert.match(boundaryMigration, /coach_member\.role='trainer'/);
  assert.doesNotMatch(boundaryMigration, /coach_member\.role in \('trainer','gym_staff','gym_admin','owner'\)/);
  assert.match(clientRoute, /p_organisation_id: organisationId/);
  assert.match(clientRoute, /p_assignment_id: assignmentId/);
  assert.match(clientRoute, /Coach assignment context required/);
  assert.match(workspace, /organisationId: string; assignmentId: string/);
  assert.match(workspace, /const identity = `\$\{client\.organisationId\}:\$\{client\.assignmentId\}`/);
  assert.match(workspace, /organisationId: selected\.organisationId, assignmentId: selected\.assignmentId/);
});

test("Coach organisation boundaries are explicit and cannot be selected by an unauthorised caller", () => {
  const boundaryMigration = read("supabase/migrations/2026-10-05-coach-organisation-boundary.sql");
  const baseMigration = read("supabase/migrations/2026-09-26-coach-safe-workflow.sql");
  const clientRoute = read("app/api/coach/clients/[id]/route.ts");
  assert.match(boundaryMigration, /a\.client_user_id=p_client_user_id and a\.organisation_id=p_organisation_id and a\.id=p_assignment_id and a\.coach_user_id=auth\.uid\(\) and a\.active/);
  assert.match(boundaryMigration, /join public\.coach_permissions p on p\.organisation_id=a\.organisation_id and p\.user_id=auth\.uid\(\) and p\.active/);
  assert.match(baseMigration, /unique \(organisation_id, coach_user_id, idempotency_key\)/);
  assert.match(boundaryMigration, /coach_session_logs\.assignment_id=assignment\.id/);
  assert.match(clientRoute, /if \(!organisationId \|\| !assignmentId\) return privateJson/);
});

test("Coach duplicate entries stay distinct by assignment rather than client identity", () => {
  const workspace = read("components/coach-workspace.tsx");
  assert.match(workspace, /key=\{identity\}/);
  assert.match(workspace, /selected\.organisationId\}:\$\{selected\.assignmentId/);
  assert.doesNotMatch(workspace, /key=\{client\.clientUserId\}/);
});

test("Coach session writes cannot use a different assignment after start", () => {
  const boundaryMigration = read("supabase/migrations/2026-10-05-coach-organisation-boundary.sql");
  assert.match(boundaryMigration, /where id=p_session_id and coach_user_id=auth\.uid\(\) returning \* into result/);
  assert.match(boundaryMigration, /a\.id=l\.assignment_id and a\.organisation_id=l\.organisation_id and a\.coach_user_id=l\.coach_user_id and a\.client_user_id=l\.client_user_id and a\.active/);
  assert.match(boundaryMigration, /coach_member\.role='trainer'/);
});

test("Coach access excludes staff and members while cover remains read-only", () => {
  const boundaryMigration = read("supabase/migrations/2026-10-05-coach-organisation-boundary.sql");
  assert.doesNotMatch(boundaryMigration, /role='member'/);
  assert.doesNotMatch(boundaryMigration, /role='gym_staff'/);
  assert.match(boundaryMigration, /p_relationship_type not in \('primary','cover'\)/);
  assert.equal(canPersistProgrammeChanges({ relationship: "cover", coachUserId: "cover-pt", programmeOwnerUserId: "primary-pt" }), false);
});

test("Coach navigation is permission-gated", () => {
  const nav = read("components/app-nav.tsx");
  const accessRoute = read("app/api/coach/access/route.ts");
  assert.match(nav, /\/api\/coach\/access/);
  assert.match(nav, /coachAllowed/);
  assert.match(accessRoute, /coach_has_access/);
  assert.match(accessRoute, /allowed: Boolean\(data\)/);
});

test("cover PT programme writes are denied by the executable policy", () => {
  assert.equal(canPersistProgrammeChanges({ relationship: "cover", coachUserId: "cover-pt", programmeOwnerUserId: "primary-pt" }), false);
  assert.equal(canPersistProgrammeChanges({ relationship: "primary", coachUserId: "cover-pt", programmeOwnerUserId: "primary-pt" }), false);
  assert.equal(canPersistProgrammeChanges({ relationship: "primary", coachUserId: "primary-pt", programmeOwnerUserId: "primary-pt" }), true);
});

test("Coach page keeps shared navigation available on access and error states", () => {
  const page = read("app/coach/page.tsx");
  assert.match(page, /import \{ AppNav \} from "@\/components\/app-nav"/);
  assert.equal((page.match(/<AppNav \/>/g) ?? []).length, 3);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/2026-11-23-coach-independent-client-relationships.sql", "utf8");
const workspace = fs.readFileSync("components/coach-workspace.tsx", "utf8");
const page = fs.readFileSync("app/coach/page.tsx", "utf8");
const relationshipsRoute = fs.readFileSync("app/api/coach/relationships/route.ts", "utf8");
const claimRoute = fs.readFileSync("app/api/coach/relationships/claim/route.ts", "utf8");
const clientRoute = fs.readFileSync("app/api/coach/clients/[id]/route.ts", "utf8");
const templates = fs.readFileSync("lib/notification-templates.ts", "utf8");

test("direct Coach relationships do not require a Club organisation or membership", () => {
  assert.match(migration, /create table if not exists public\.coach_relationships/);
  assert.match(migration, /organisation_id uuid references public\.club_organisations/);
  assert.match(migration, /coach_user_id uuid not null references auth\.users/);
  assert.match(migration, /client_user_id uuid references auth\.users/);
  assert.match(migration, /coach_relationships r .*r\.coach_user_id=auth\.uid\(\) and r\.status='active'/s);
  assert.doesNotMatch(migration.slice(migration.indexOf("from public.coach_relationships r"), migration.indexOf("create or replace function public.coach_get_client")), /join public\.club_members cm on cm\.organisation_id=r\.organisation_id/);
});

test("direct access remains explicit and Club-linked access remains organisation-scoped", () => {
  assert.match(migration, /create table if not exists public\.coach_access/);
  assert.match(migration, /coach_has_explicit_access/);
  assert.match(migration, /coach_permissions permission on permission\.organisation_id=a\.organisation_id/);
  assert.match(migration, /coach_grant_direct_access\(p_organisation_id uuid,p_user_id uuid,p_active boolean\)/);
  assert.match(migration, /staff\.permissions_manage/);
});

test("exact email connection and invitation use authenticated claim without fake Auth users", () => {
  assert.match(workspace, /Add client/);
  assert.match(workspace, /exact email/);
  assert.match(relationshipsRoute, /coach_request_relationship/);
  assert.match(migration, /select id into v_client from auth\.users where lower\(email\)=v_email/);
  assert.match(migration, /coach_relationship_invite/);
  assert.match(templates, /coach_relationship_invite/);
  assert.match(templates, /\/coach\/claim/);
  assert.match(migration, /coach_claim_relationships/);
  assert.match(claimRoute, /coach_claim_relationships/);
  assert.doesNotMatch(migration, /insert into auth\.users/);
});

test("primary and cover relationships preserve programme ownership", () => {
  assert.match(migration, /relationship_type text not null check \(relationship_type in \('primary','cover'\)\)/);
  assert.match(migration, /if v_owner is null then raise exception 'A cover PT needs an active primary PT'/);
  assert.match(migration, /active_primary_client_uq/);
  assert.match(workspace, /Primary PT/);
  assert.match(workspace, /Cover PT/);
});

test("Coach client access cannot enumerate unrelated users and detail is relationship-bound", () => {
  assert.match(migration, /where r\.id=p_assignment_id and r\.client_user_id=p_client_user_id and r\.coach_user_id=auth\.uid\(\) and r\.status='active'/);
  assert.match(migration, /a\.organisation_id=p_organisation_id and a\.id=p_assignment_id and a\.coach_user_id=auth\.uid\(\) and a\.active/);
  assert.match(relationshipsRoute, /p_client_email: email/);
  assert.doesNotMatch(relationshipsRoute, /select\s+\*\s+from\s+public\.profiles/i);
});

test("direct and Club sessions use the same authorised logging boundary", () => {
  assert.match(migration, /relationship_id uuid references public\.coach_relationships/);
  assert.match(migration, /coach_session_logs_direct_key_uq/);
  assert.match(migration, /coach_start_session\(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid/);
  assert.match(migration, /Coach session update denied/);
  assert.match(clientRoute, /p_relationship_id: relationshipId/);
});

test("unexpected Coach list failures are not shown as fake permission failures", () => {
  assert.match(page, /Coach service unavailable/);
  assert.match(page, /error\.code === "42501"/);
  assert.match(page, /console\.error\("\[coach\] client list failed"/);
});

test("zero-client Coach state has a useful Add client action", () => {
  assert.match(workspace, /Add your first client/);
  assert.match(workspace, /Connect with an existing R12 user or invite a client to join/);
  assert.match(workspace, /onClick=\{\(\) => setShowAddClient\(true\)\}/);
});

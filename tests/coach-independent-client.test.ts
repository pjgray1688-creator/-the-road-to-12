import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/2026-11-23-coach-independent-client-relationships.sql", "utf8");
const referralMigration = fs.readFileSync("supabase/migrations/2026-11-24-coach-member-search-and-referrals.sql", "utf8");
const workspace = fs.readFileSync("components/coach-workspace.tsx", "utf8");
const page = fs.readFileSync("app/coach/page.tsx", "utf8");
const relationshipsRoute = fs.readFileSync("app/api/coach/relationships/route.ts", "utf8");
const claimRoute = fs.readFileSync("app/api/coach/relationships/claim/route.ts", "utf8");
const searchRoute = fs.readFileSync("app/api/coach/member-search/route.ts", "utf8");
const referralRoute = fs.readFileSync("app/api/coach/referrals/[token]/route.ts", "utf8");
const clientRoute = fs.readFileSync("app/api/coach/clients/[id]/route.ts", "utf8");
const templates = fs.readFileSync("lib/notification-templates.ts", "utf8");
const manifest = fs.readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

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
  assert.match(workspace, /Search by name/);
  assert.match(relationshipsRoute, /coach_create_referral_invite/);
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
  assert.match(page, /firstError\.code === "42501"/);
  assert.match(page, /console\.error\("\[coach\] workspace load failed"/);
});

test("zero-client Coach state has a useful Add client action", () => {
  assert.match(workspace, /Build your client list/);
  assert.match(workspace, /Madhouse member/);
  assert.match(workspace, /Private client/);
  assert.equal((workspace.match(/className="primary" onClick=\{\(\) => setShowAddClient\(true\)\}>Add client/g) ?? []).length, 1);
  assert.doesNotMatch(workspace, /coach-empty-clients/);
});

test("member search is organisation-scoped and never a global people directory", () => {
  assert.match(referralMigration, /coach_list_member_search_contexts/);
  assert.match(referralMigration, /coach_search_club_members\(p_organisation_id uuid,p_query text\)/);
  assert.match(referralMigration, /join public\.club_members coach_member/);
  assert.match(referralMigration, /m\.role='member'/);
  assert.doesNotMatch(referralMigration, /from public\.profiles p\s+where.*ilike/s);
  assert.match(searchRoute, /p_organisation_id/);
  assert.doesNotMatch(searchRoute, /auth\.users/);
});

test("pending relationships and private referral claims are durable and replay-safe", () => {
  assert.match(referralMigration, /create table if not exists public\.coach_referral_invites/);
  assert.match(referralMigration, /token_hash text not null unique/);
  assert.match(referralMigration, /expires_at timestamptz not null/);
  assert.match(referralMigration, /revoked_at is null and claimed_at is null/);
  assert.match(referralMigration, /coach_list_pending_relationships/);
  assert.match(referralMigration, /coach_revoke_pending_relationship/);
  assert.match(referralMigration, /coach_resend_referral_invite/);
  assert.match(referralMigration, /coach_claim_referral\(p_token text\)/);
  assert.match(referralRoute, /coach_claim_referral/);
  assert.match(workspace, /Awaiting acceptance/);
  assert.match(workspace, /Resend \/ copy link/);
});

test("self-add has a specific safe error and referral claim does not create Club membership", () => {
  assert.match(relationshipsRoute, /You can’t add your own R12 account as a client/);
  assert.match(referralMigration, /p_client_user_id=auth\.uid\(\)/);
  assert.doesNotMatch(referralMigration.slice(referralMigration.indexOf("coach_claim_referral")), /insert into public\.club_members/);
  assert.match(referralMigration, /client_user_id=auth\.uid\(\),status='active'/);
});

test("the deployed migration remains a forward-only addition and keeps existing relationships", () => {
  assert.doesNotMatch(migration, /drop table|delete from public\.coach_relationships|insert into auth\.users/i);
  assert.match(migration, /status='pending'/);
  assert.match(migration, /organisation_id uuid references public\.club_organisations/);
  assert.match(manifest, /2026-11-24-coach-member-search-and-referrals\.sql/);
});

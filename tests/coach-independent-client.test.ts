import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/2026-11-23-coach-independent-client-relationships.sql", "utf8");
const referralMigration = fs.readFileSync("supabase/migrations/2026-11-24-coach-member-search-and-referrals.sql", "utf8");
const coverFixMigration = fs.readFileSync("supabase/migrations/2026-11-25-coach-cover-referral-fix.sql", "utf8");
const invitationMigration = fs.readFileSync("supabase/migrations/2026-11-26-coach-invitation-email-polish.sql", "utf8");
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
  assert.equal((workspace.match(/coach-header-action"/g) ?? []).length, 1);
  assert.doesNotMatch(workspace, /Replay Coach tutorial/);
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
  assert.match(workspace, /Copy invite link/);
  assert.match(workspace, /Resend email/);
  assert.doesNotMatch(workspace, /Resend \/ copy link/);
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
  assert.match(manifest, /2026-11-25-coach-cover-referral-fix\.sql/);
});

test("private Cover referrals defer ownership until claim and resolve the client's real primary PT", () => {
  assert.match(coverFixMigration, /p_relationship_type='primary' then v_owner:=auth\.uid\(\); end if/);
  assert.match(coverFixMigration, /if p_relationship_type='cover' then|relationship_type='cover'/);
  assert.match(coverFixMigration, /programme_owner_user_id=null/);
  assert.match(coverFixMigration, /p\.client_user_id=auth\.uid\(\).*p\.relationship_type='primary'/s);
  assert.match(coverFixMigration, /coalesce\(p\.programme_owner_user_id,p\.coach_user_id\)/);
  assert.match(coverFixMigration, /coalesce\(a\.programme_owner_user_id,a\.coach_user_id\)/);
  assert.match(coverFixMigration, /Your Coach needs an active primary PT before a cover connection can be accepted/);
  assert.doesNotMatch(coverFixMigration.slice(coverFixMigration.indexOf("coach_create_referral_invite"), coverFixMigration.indexOf("coach_claim_referral")), /select programme_owner_user_id into v_owner\s+from public\.coach_relationships\s+where coach_user_id=auth\.uid\(\)/s);
});

test("referral tokens use SHA-256 for new invites and preserve one-use legacy compatibility", () => {
  assert.match(coverFixMigration, /encode\(digest\(v_token,'sha256'\),'hex'\)/);
  assert.match(coverFixMigration, /token_hash=encode\(digest\(btrim\(p_token\),'sha256'\),'hex'\) or token_hash=md5/);
  assert.match(coverFixMigration, /claimed_at is null and expires_at>now\(\)/);
  assert.match(coverFixMigration, /revoked_at is null/);
  assert.match(coverFixMigration, /update public\.coach_referral_invites set claimed_at=now\(\)/);
});

test("private no-email referrals remain email-optional and notification-safe", () => {
  assert.match(coverFixMigration, /v_email text:=nullif\(lower\(btrim\(p_client_email\)\),''\)/);
  assert.match(invitationMigration, /if v_email is not null then[\s\S]*club_member_notification_intents/);
  assert.match(invitationMigration, /emailQueued/);
  assert.match(referralMigration, /alter column user_id drop not null/);
  assert.match(workspace, /Email \(optional\)/);
});

test("Coach invitation payloads and preview are safe and app-oriented", () => {
  assert.match(invitationMigration, /coachName/);
  assert.match(invitationMigration, /expiresAt/);
  assert.match(invitationMigration, /create or replace function public\.coach_preview_referral/);
  assert.match(invitationMigration, /grant execute on function public\.coach_preview_referral\(text\) to anon,authenticated/);
  assert.match(templates, /has invited you to train with them on R12/);
  assert.match(templates, /R12 keeps your programme/);
  assert.match(referralRoute, /export async function GET/);
  assert.match(referralRoute, /coach_preview_referral/);
});

test("client referral returns to member R12, not the Coach workspace", () => {
  const claim = fs.readFileSync("components/coach-referral-claim.tsx", "utf8");
  assert.match(claim, /next=.*returnTo/);
  assert.match(claim, /Continue to R12/);
  assert.match(claim, /href="\/"/);
  assert.doesNotMatch(claim, /href="\/coach">Open Coach/);
});

test("notification links use the explicit application origin", () => {
  const provider = fs.readFileSync("lib/notification-provider.ts", "utf8");
  assert.match(provider, /R12_APP_BASE_URL/);
  assert.doesNotMatch(provider, /R12_APP_BASE_URL[\s\S]*\?\?\s*"https:\/\/r12\.live"/);
});

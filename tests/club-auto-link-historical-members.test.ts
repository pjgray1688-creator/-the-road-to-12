import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { autoLinkVerifiedMadhouseMember } from "../lib/madhouse-auto-link";

const root = process.cwd();
const migration = readFileSync(`${root}/supabase/migrations/2026-11-19-club-auto-link-verified-imported-members.sql`, "utf8");
const memberHub = readFileSync(`${root}/app/member-hub/page.tsx`, "utf8");
const joinPage = readFileSync(`${root}/app/join/[clubSlug]/page.tsx`, "utf8");
const claimPage = readFileSync(`${root}/app/member-hub/link/page.tsx`, "utf8");
const joinAction = readFileSync(`${root}/app/club/join/actions.ts`, "utf8");
const joinForm = readFileSync(`${root}/components/club-joining-form.tsx`, "utf8");
const healthMigration = readFileSync(`${root}/supabase/migrations/2026-11-20-club-versioned-join-health-declarations.sql`, "utf8");

test("verified Madhouse account invokes the server-side automatic link RPC idempotently", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return { data: { state: "already_linked" }, error: null }; } };
  assert.equal(await autoLinkVerifiedMadhouseMember(client, undefined, { email_confirmed_at: "2026-11-18T10:00:00Z" }), "already_linked");
  assert.deepEqual(calls, ["club_auto_link_verified_imported_member"]);
  assert.equal(await autoLinkVerifiedMadhouseMember(client, undefined, {}), "email_verification_required");
  assert.equal(calls.length, 1);
});

test("linking runs before Member Hub, membership-link and Madhouse join state loads", () => {
  assert.match(memberHub, /autoLinkVerifiedMadhouseMember[\s\S]*club_list_my_memberships/);
  assert.match(joinPage, /autoLinkVerifiedMadhouseMember[\s\S]*club_get_my_join_state/);
  assert.match(claimPage, /autoLinkVerifiedMadhouseMember[\s\S]*club_preview_existing_member_claim/);
});

test("SQL requires a confirmed email and unique unambiguous imported identity", () => {
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /slug='madhouse-gym'/);
  assert.match(migration, /source_system='clubmanager'/);
  assert.match(migration, /club_imported_member_email_is_ambiguous/);
  assert.match(migration, /shared_or_placeholder/);
  assert.match(migration, /for update/);
  assert.match(migration, /club_claim_existing_member\(v_org\.id,v_customer\.id\)/);
  assert.match(migration, /member\.account_self_claimed/);
  assert.match(migration, /to authenticated/);
  assert.match(migration, /from public,anon,authenticated/);
});

test("ambiguous imported accounts cannot use the old self-claim button as a bypass", () => {
  assert.match(migration, /create or replace function public\.club_preview_existing_member_claim/);
  assert.match(migration, /create or replace function public\.club_claim_existing_member/);
  assert.match(migration, /Shared or ambiguous legacy identity requires staff verification/);
  assert.match(migration, /return jsonb_build_object\('state','ambiguous'\)/);
});

test("active overlapping gym membership blocks a duplicate joining request", () => {
  assert.match(migration, /club_block_duplicate_active_gym_join/);
  assert.match(migration, /e\.entitlement_key='gym_access'/);
  assert.match(migration, /m\.status in \('active','paused'\)/);
  assert.match(migration, /An existing gym membership is already linked/);
  assert.match(migration, /m\.id is distinct from new\.membership_id/);
});

test("confirmed payment activates configured-duration passes; pending payment cannot grant access", () => {
  const stripe = readFileSync(`${root}/supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql`, "utf8");
  const joining = readFileSync(`${root}/supabase/migrations/2026-11-18-member-acquisition-onboarding.sql`, "utf8");
  assert.match(stripe, /r\.upfront_payment_state<>'confirmed'/);
  assert.match(stripe, /club_activate_verified_stripe_join/);
  assert.match(joining, /make_interval\(days=>p\.duration_days\)/);
  assert.match(stripe, /club_entitlement_grants/);
});

test("auto-linking is tenant specific, preserves existing customer fields, and is available before Member Hub credentials load", () => {
  assert.match(migration, /where slug='madhouse-gym' and active/);
  assert.match(migration, /where c\.organisation_id=v_org\.id and lower\(btrim\(c\.email\)\)=v_email/);
  assert.match(migration, /update public\.club_customers set user_id=auth\.uid\(\),updated_at=now\(\)/);
  assert.doesNotMatch(migration, /set email\s*=|set phone\s*=|set display_name\s*=/i);
  assert.match(memberHub, /autoLinkVerifiedMadhouseMember[\s\S]*club_list_my_memberships/);
  assert.match(memberHub, /getMemberOperationalProfile/);
  assert.match(memberHub, /club_list_my_memberships/);
});

test("health declarations remain unpublished by default, versioned, auditable and enforced server-side when required", () => {
  assert.match(healthMigration, /status text not null default 'draft'/);
  assert.match(healthMigration, /required_for_joining boolean not null default false/);
  assert.match(healthMigration, /accepted_at timestamptz not null default now\(\)/);
  assert.match(healthMigration, /membership\.health_declaration_accepted/);
  assert.match(healthMigration, /club_require_join_health_declaration/);
  assert.match(healthMigration, /Required health declaration has not been accepted/);
  assert.match(joinForm, /required=\{healthDeclaration\.required\}/);
  assert.match(joinAction, /input\.healthDeclarationVersionId !== declaration\.id/);
  assert.match(joinAction, /club_accept_join_health_declaration/);
  assert.doesNotMatch(healthMigration, /insert into public\.club_join_health_declaration_versions/i);
});

test("failed or pending checkout cannot activate a pass; the existing provider handler requires verified payment", () => {
  const provider = readFileSync(`${root}/supabase/migrations/2026-12-01-paid-member-provider-checkout.sql`, "utf8");
  assert.match(provider, /r\.upfront_payment_state<>'confirmed'/);
  assert.match(provider, /upfront_payment_state/);
  assert.match(joinAction, /club_start_membership_joining_optional_home_location/);
  assert.match(joinAction, /club_activate_no_payment_join/);
});

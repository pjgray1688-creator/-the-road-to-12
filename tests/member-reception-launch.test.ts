import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requiresMadhouseProviderCheckout } from "../lib/madhouse-billing";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/2026-11-30-member-reception-launch-safety.sql");
const actions = read("app/club/members/actions.ts");
const onboarding = read("components/club-member-onboarding.tsx");
const assignment = read("components/club-membership-assignment.tsx");
const profile = read("app/club/members/[userId]/page.tsx");

test("paid Madhouse products cannot bypass trusted checkout through staff assignment", () => {
  assert.equal(requiresMadhouseProviderCheckout("madhouse-gym", { priceMinor: 2700, sellable: true }), true);
  assert.equal(requiresMadhouseProviderCheckout("madhouse-gym", { priceMinor: 0, sellable: true }), false);
  assert.equal(requiresMadhouseProviderCheckout("madhouse-gym", { priceMinor: 2700, sellable: false }), false);
  assert.equal(requiresMadhouseProviderCheckout("another-club", { priceMinor: 2700, sellable: true }), false);
  assert.match(actions, /requiresMadhouseProviderCheckout\(context\.organisation\.slug, product\)/);
  assert.doesNotMatch(actions, /item\.kind === "membership" && item\.sellable/);
  assert.match(migration, /new\.source='staff_assignment'/);
  assert.match(migration, /o\.slug='madhouse-gym' and p\.sellable and p\.price_minor>0/);
  assert.match(migration, /Paid Madhouse memberships require trusted checkout confirmation/);
});

test("reception can create a person without activating a paid membership", () => {
  assert.match(onboarding, /required=\{Boolean\(existingId\)\}/);
  assert.match(onboarding, /No membership yet/);
  assert.match(onboarding, /Add member record/);
  assert.match(onboarding, /Open member record/);
  assert.match(onboarding, /on their own device/);
});

test("membership assignment retries use one client-generated idempotency key", () => {
  assert.match(assignment, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
  assert.match(assignment, /idempotencyKey/);
  assert.match(assignment, /setIdempotencyKey\(crypto\.randomUUID\(\)\)/);
});

test("customer creation serialises normalised email checks at the database boundary", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lower\(btrim\(email\)\)=v_email/);
  assert.match(migration, /errcode='23505'/);
  assert.match(actions, /error\.code === "INVALID"/);
});

test("linked member profile exposes authorised checkout and recurring billing state", () => {
  assert.match(migration, /club_get_member_join_state/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'payments\.take'\)/);
  assert.match(migration, /revoke all on function public\.club_get_member_join_state\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(profile, /club_get_member_join_state/);
  assert.match(profile, /club_list_customer_billing/);
  assert.match(profile, /Upfront card payment/);
  assert.match(profile, /Recurring Direct Debit/);
});

test("launch migration is included in the reviewed deployment manifest", () => {
  assert.match(read("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt"), /2026-11-30-member-reception-launch-safety\.sql/);
});

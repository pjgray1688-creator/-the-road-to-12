import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canAccessGym, isValidAt } from "../lib/club";
import { madhouseCatalogue } from "../lib/madhouse-catalogue";
import { isGoldenTicketLifetimePackage, stageMemberCsv } from "../lib/club-member-import";
import { GOLDEN_TICKET_LIFETIME_LABEL, membershipPresentation } from "../lib/club-membership-presentation";
import { mapProduct } from "../lib/supabase-club-repository";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("canonical Golden Ticket is explicitly lifetime, one-off, multi-location and preserves its existing discount", () => {
  const golden = madhouseCatalogue.find(product => product.name === "Golden Ticket Founding Membership");
  assert.ok(golden);
  assert.equal(golden.isLifetime, true);
  assert.equal(golden.billing, "one_off");
  assert.equal(mapProduct({ id: "golden", organisation_id: "madhouse", name: golden.name, kind: golden.kind, price_minor: golden.priceMinor, currency: golden.currency, billing: golden.billing, duration_days: null, is_lifetime: true, sellable: false }).isLifetime, true);
  assert.equal(golden.durationDays, undefined);
  assert.equal(golden.sellable, false);
  assert.equal(golden.entitlements.find(item => item.entitlementKey === "gym_access")?.scope, "future_locations");
  assert.deepEqual(golden.entitlements.find(item => item.entitlementKey === "discount")?.discount, { percent: 20, period: "month", maxUses: 1 });
});

test("Golden Ticket import preserves source expiry evidence without applying it as an effective end", () => {
  const csv = "Name,Email,Member ID,Membership,Status,Join Date,Expiry Date\nAlex Member,alex@example.test,MAD10603,Golden Ticket Founding Membership,active,2020-01-01,02/09/2031";
  const staged = stageMemberCsv(csv, { fullName: "name", email: "email", legacyReference: "member id", membershipName: "membership", membershipStatus: "status", startDate: "join date", endDate: "expiry date" });
  assert.equal(staged.rows[0].normalized.goldenTicketLifetimeCandidate, true);
  assert.equal(staged.rows[0].normalized.endDate, "02/09/2031");
  assert.equal(staged.rows[0].blockers.some(reason => reason.includes("Date format")), false);
  assert.equal(isGoldenTicketLifetimePackage("Golden Ticket Founding Membership"), true);
  assert.equal(isGoldenTicketLifetimePackage("Golden Ticket Prize Promotion"), false);

  const migration = source("../supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql");
  assert.match(migration, /'legacy_expiry_date',case when coalesce\(product_is_lifetime,false\) then legacy_expiry_date else null end/);
  assert.match(migration, /'expiry_policy',case when coalesce\(product_is_lifetime,false\) then 'lifetime_no_effective_expiry'/);
  assert.match(migration, /end_at:=case when coalesce\(product_is_lifetime,false\) or legacy_expiry_date is null then null/);
  assert.match(migration, /club_allow_lifetime_import_expiry_evidence/);
  assert.match(migration, /club_revalidate_after_package_mapping/);
  assert.match(migration, /perform public\.club_revalidate_member_import_batch\(new\.organisation_id,new\.batch_id\)/);
  const membershipBackfill = migration.split("with legacy_expiries as (")[1]?.split("create or replace function public.club_reject_lifetime_billing_arrangement")[0] ?? "";
  assert.match(membershipBackfill, /set ends_at=null/);
  assert.doesNotMatch(membershipBackfill, /set\s+status\s*=/i);
});

test("promo memberships are not inferred as Golden Ticket and retain normal date validation", () => {
  const csv = "Name,Email,Member ID,Membership,Status,Join Date,Expiry Date\nAlex Member,alex@example.test,MAD10603,Golden Ticket Prize Promotion,active,2020-01-01,02/09/2031";
  const staged = stageMemberCsv(csv, { fullName: "name", email: "email", legacyReference: "member id", membershipName: "membership", membershipStatus: "status", startDate: "join date", endDate: "expiry date" });
  assert.equal(staged.rows[0].normalized.goldenTicketLifetimeCandidate, undefined);
  assert.ok(staged.rows[0].blockers.some(reason => reason.includes("Date format")));
});

test("open-ended Golden Ticket validity lasts indefinitely and future_locations remains subject to location membership", () => {
  const farFuture = "2150-12-31T23:59:59.000Z";
  assert.equal(isValidAt({ startsAt: "2020-01-01T00:00:00.000Z" }, farFuture), true);
  const grant = { id: "synthetic", userId: "member", organisationId: "madhouse", entitlementKey: "gym_access", scope: "future_locations" as const, validity: { startsAt: "2020-01-01T00:00:00.000Z" }, source: "founding" as const };
  assert.equal(canAccessGym("member", "madhouse", "rotherham", [grant], farFuture), true);
  assert.equal(canAccessGym("member", "madhouse", "carlton", [grant], farFuture), true);
  assert.equal(canAccessGym("other-member", "madhouse", "carlton", [grant], farFuture), false);
});

test("assignment and database guards prevent expiry and all billing enrollment for lifetime products", () => {
  const action = source("../app/club/members/actions.ts");
  const migration = source("../supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql");
  assert.match(action, /product\.isLifetime && input\.endsAt/);
  assert.match(action, /Golden Ticket — Lifetime Membership cannot have an end date/);
  const assignment = source("../components/club-membership-assignment.tsx");
  assert.match(assignment, /disabled=\{selectedProduct\?\.isLifetime\}/);
  assert.match(assignment, /setEndsAt\(""\)/);
  assert.match(migration, /new\.ends_at:=null/);
  assert.match(migration, /before insert or update of membership_id,organisation_id,frequency,provider_type,payment_method_family,state/);
  assert.match(migration, /before insert or update of membership_id,organisation_id,arrangement_id,frequency/);
  assert.match(migration, /Golden Ticket lifetime memberships cannot have billing arrangements/);
  assert.match(migration, /Golden Ticket lifetime memberships cannot have billing obligations/);
  assert.match(migration, /active_arrangements>0 or open_obligations>0/);
});

test("staff and member surfaces present the lifetime label and never-expiring copy without changing access state", () => {
  assert.deepEqual(membershipPresentation("Old catalogue name", true), { name: GOLDEN_TICKET_LIFETIME_LABEL, validity: "Never expires" });
  assert.deepEqual(membershipPresentation("Standard Monthly", false), { name: "Standard Monthly", validity: undefined });
  const staffProfile = source("../app/club/members/[userId]/page.tsx");
  const memberHub = source("../components/member-hub.tsx");
  const clubMember = source("../components/club-member-home.tsx");
  assert.match(staffProfile, /currentPresentation\?\.validity/);
  assert.match(memberHub, /lifetimeProductIds\?\.includes\(membership\.productId\)/);
  assert.match(clubMember, /lifetimeProductIds\.includes\(item\.productId\)/);
  assert.match(staffProfile, /profile\.access\?\.reason/);
  assert.match(memberHub, /item\.profile\.access\?\.state\s*!==\s*"active"/);
});

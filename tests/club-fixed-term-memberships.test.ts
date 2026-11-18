import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canAccessGym } from "../lib/club";
import { fixedTermEndDate, importedExpiryBoundaryDate, validFixedTerm } from "../lib/club-fixed-term";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fixed-term duration supports validated day, week and calendar-month terms", () => {
  assert.equal(validFixedTerm(3, "month"), true);
  assert.equal(validFixedTerm(0, "month"), false);
  assert.equal(validFixedTerm(1201, "day"), false);
  assert.equal(fixedTermEndDate("2026-09-15", 3, "month"), "2026-12-15");
  assert.equal(fixedTermEndDate("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(fixedTermEndDate("2026-11-18", 3, "week"), "2026-12-09");
  assert.throws(() => fixedTermEndDate("2026-02-30", 1, "month"), /invalid_start_date/);
});

test("inclusive imported expiry becomes the next local-date exclusive boundary", () => {
  assert.equal(importedExpiryBoundaryDate("2026-12-15"), "2026-12-16");
  assert.equal(importedExpiryBoundaryDate("2026-12-11"), "2026-12-12");
  assert.throws(() => importedExpiryBoundaryDate("not-a-date"), /invalid_expiry_date/);
});

test("the same configured product can issue separate member-specific expiry boundaries", () => {
  const sharedProductId = "fixed-term-three-months";
  const alfie = { startsAt: "2026-09-16T00:00:00+01:00", endsAt: "2026-12-16T00:00:00+00:00" };
  const chelsea = { startsAt: "2026-09-12T00:00:00+01:00", endsAt: "2026-12-12T00:00:00+00:00" };
  assert.equal(sharedProductId, "fixed-term-three-months");
  assert.equal(alfie.endsAt, "2026-12-16T00:00:00+00:00");
  assert.equal(chelsea.endsAt, "2026-12-12T00:00:00+00:00");
  const grant = (userId: string, validity: typeof alfie) => ({ id: userId, userId, organisationId: "madhouse", membershipId: userId, entitlementKey: "gym_access", scope: "future_locations" as const, validity, source: "purchase" as const });
  const locations = ["rotherham", "carlton"];
  for (const [userId, validity, until] of [["alfie", alfie, "2026-12-15T23:59:59+00:00"], ["chelsea", chelsea, "2026-12-11T23:59:59+00:00"]] as const) {
    for (const location of locations) assert.equal(canAccessGym(userId, "madhouse", location, [grant(userId, validity)], until), true);
    for (const location of locations) assert.equal(canAccessGym(userId, "madhouse", location, [grant(userId, validity)], validity.endsAt), false);
  }
});

test("membership validity is not active before its start, after expiry, or after suspension", () => {
  const base = { id: "g1", userId: "member", organisationId: "madhouse", membershipId: "m1", entitlementKey: "gym_access", scope: "future_locations" as const, validity: { startsAt: "2026-11-20T00:00:00Z", endsAt: "2027-02-20T00:00:00Z" }, source: "purchase" as const };
  assert.equal(canAccessGym("member", "madhouse", "rotherham", [base], "2026-11-19T23:59:59Z"), false);
  assert.equal(canAccessGym("member", "madhouse", "rotherham", [base], "2026-11-20T00:00:00Z"), true);
  assert.equal(canAccessGym("member", "other-org", "rotherham", [base], "2026-12-01T00:00:00Z"), false);
  const suspended = { ...base, validity: { ...base.validity, endsAt: "2026-11-19T00:00:00Z" } };
  assert.equal(canAccessGym("member", "madhouse", "rotherham", [suspended], "2026-11-20T00:00:00Z"), false);
  const accessSql = read("supabase/migrations/2026-09-10-club-membership-access.sql");
  assert.match(accessSql, /m\.status='active'/);
  assert.match(accessSql, /m\.starts_at<=p_at and \(m\.ends_at is null or m\.ends_at>p_at\)/);
});

test("SQL keeps fixed-term products one-off, manager-controlled, auditable and idempotent", () => {
  const sql = read("supabase/migrations/2027-02-02-club-fixed-term-memberships.sql");
  assert.match(sql, /fixed_term_value integer/);
  assert.match(sql, /fixed_term_unit text/);
  assert.match(sql, /billing='one_off'/);
  assert.match(sql, /club_has_active_role\(p_organisation_id,array\['owner','gym_admin'\]\)/);
  assert.match(sql, /club_save_fixed_term_membership_product/);
  assert.match(sql, /club_assign_fixed_term_membership/);
  assert.match(sql, /assignment_idempotency_key=p_idempotency_key/);
  assert.match(sql, /membership\.fixed_term_granted/);
  assert.match(sql, /billing_created',false/);
  assert.match(sql, /club_membership_initial_charges/);
  assert.match(sql, /fixed_term_value_snapshot/);
  assert.match(sql, /club_fixed_term_end\(new\.starts_at,term_value,term_unit\)/);
  assert.match(sql, /'Europe\/London'/);
  assert.match(sql, /grant execute on function public\.club_assign_fixed_term_membership/);
  assert.doesNotMatch(sql, /insert into public\.club_membership_billing_arrangements/);
  assert.doesNotMatch(sql, /insert into public\.club_membership_billing_obligations/);
  assert.doesNotMatch(sql, /insert into public\.club_paypal_pay_in_3_orders/);
});

test("historical-only product guards remain in force and explicit import dates drive access", () => {
  const sql = read("supabase/migrations/2027-02-02-club-fixed-term-memberships.sql");
  const historical = read("supabase/migrations/2026-11-18-club-historical-import-categories.sql");
  assert.match(historical, /club_reject_active_historical_import_membership/);
  assert.match(historical, /club_reject_historical_import_entitlement/);
  assert.match(sql, /legacy_import_category is null/);
  assert.match(sql, /row_data\.normalized_values->>'endDate'/);
  assert.match(sql, /if expiry_date is not null then new\.ends_at:=\(expiry_date\+1\)::timestamp at time zone 'Europe\/London'/);
  assert.match(sql, /club_sync_imported_membership_grant_boundary/);
  assert.match(sql, /legacy_import.*then/);
  const importPage = read("app/club/members/import/page.tsx");
  const importUi = read("components/club-member-import.tsx");
  assert.match(importPage, /fixedTermValue: product\.fixedTermValue/);
  assert.match(importUi, /fixed term .*no renewal/);
  assert.match(importUi, /historical only, no billing or access/);
});

test("staff configuration and assignment are surfaced only in management workflows", () => {
  const page = read("app/club/memberships/page.tsx");
  const component = read("components/club-fixed-term-membership-products.tsx");
  const action = read("app/club/memberships/actions.ts");
  const assignment = read("components/club-membership-assignment.tsx");
  const assignmentAction = read("app/club/members/actions.ts");
  assert.match(page, /memberships\.manage/);
  assert.match(page, /ClubFixedTermMembershipProducts/);
  assert.match(component, /Calendar months/);
  assert.match(component, /Available for public purchase/);
  assert.match(action, /context\.role\)/);
  assert.match(action, /club_save_fixed_term_membership_product/);
  assert.match(assignment, /prepaid/);
  assert.match(assignment, /complimentary/);
  assert.match(assignmentAction, /club_assign_fixed_term_membership/);
  assert.match(assignmentAction, /context\.role !== "owner" && context\.role !== "gym_admin"/);
});

test("fixed-term purchase uses a one-off path and explicit recurring changes remain separate", () => {
  const sql = read("supabase/migrations/2027-02-02-club-fixed-term-memberships.sql");
  const join = read("app/club/join/page.tsx");
  const form = read("components/club-joining-form.tsx");
  assert.match(sql, /when p\.fixed_term_value is not null then 'one_off'/);
  assert.match(join, /fixed_term_value/);
  assert.match(form, /does not renew automatically/);
  assert.match(sql, /billing='one_off'/);
  assert.match(sql, /p\.billing<>'one_off'/);
  assert.match(sql, /billing,duration_days,fixed_term_value,fixed_term_unit,is_lifetime/);
  assert.doesNotMatch(sql, /p_billing/);
  assert.doesNotMatch(sql, /insert into public\.club_membership_billing_arrangements/);
});

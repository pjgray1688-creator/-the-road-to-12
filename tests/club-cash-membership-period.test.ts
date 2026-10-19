import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql", "utf8");
const fixture = readFileSync("tests/sql/member-household-billing-lifecycle.sql", "utf8");
const anchorGuardFixture = readFileSync("tests/sql/member-billing-anchor-migration-guard.sql", "utf8");
const anchorGuardSuccessFixture = readFileSync("tests/sql/member-billing-anchor-migration-guard-success.sql", "utf8");
const postgresHarness = readFileSync("scripts/validate-coach-nutrition-reconciliation-postgres.sh", "utf8");
const action = readFileSync("app/club/shop/actions.ts", "utf8");
const component = readFileSync("components/club-membership-cash-payment.tsx", "utf8");
const accessSafetyFix = readFileSync("supabase/migrations/2027-01-01-club-access-safety-empty-booking-fix.sql", "utf8");
const anchorPreflight = readFileSync("supabase/deployment/madhouse-monthly-billing-anchor-preflight.sql", "utf8");
const anchorRunbook = readFileSync("docs/madhouse-billing-anchor-resolution.md", "utf8");
const deploymentRunner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");

test("cash settlement records received date, scheduled billing period and paid-through date separately", () => {
  assert.match(migration, /drop constraint if exists club_membership_billing_arrangement_payment_method_family_check/);
  assert.match(migration, /drop constraint if exists club_membership_billing_arrangements_payment_method_family_chec/);
  assert.match(migration, /drop constraint if exists club_member_billing_arrangement_method_family_check/);
  assert.match(migration, /drop constraint if exists club_member_billing_arrangement_method_family_check;[\s\S]*add constraint club_member_billing_arrangement_method_family_check/);
  assert.match(migration, /add constraint club_member_billing_arrangement_method_family_check\s+check \(payment_method_family in \('direct_debit','recurring_card','cash','other'\)\)/);
  assert.match(migration, /add column if not exists billing_period_start date/);
  assert.match(migration, /add column if not exists billing_period_end date/);
  assert.match(migration, /receipt_date<>p_receipt_date/);
  assert.match(migration, /billing_period_start<>p_billing_period_start/);
  assert.match(migration, /paid_through_date<>p_paid_through_date/);
  assert.match(migration, /expected_start:.*coverage_start_at.*next_due_at/s);
  assert.match(migration, /membership\.cash_payment_verified/);
  assert.match(migration, /billingPeriodStart/);
  assert.match(action, /p_billing_period_start: input\.billingPeriodStart/);
  assert.match(component, /Billing period starts/);
  assert.match(component, /Billing period ends/);
  assert.match(component, /Paid through/);
  assert.match(component, /Date received/);
});

test("monthly anchor migration stops for unresolved legacy rows and never treats next_due_at as proof", () => {
  assert.match(migration, /select count\(\*\)::integer into unresolved_count[\s\S]*from public\.club_membership_billing_arrangements\s+where frequency='monthly' and billing_anchor_day is null/);
  assert.match(migration, /select count\(distinct a\.id\)::integer into conflicting_count/);
  assert.match(migration, /unresolved_count>0 or conflicting_count>0/);
  assert.match(migration, /Cash-period migration stopped[\s\S]*conflicting schedule evidence/);
  assert.doesNotMatch(migration, /update public\.club_membership_billing_arrangements\s+set billing_anchor_day\s*=\s*extract\(day from next_due_at/i);
  assert.match(deploymentRunner, /--single-transaction -f "\$repo_root\/\$migration"/);
  assert.match(postgresHarness, /--single-transaction --file=supabase\/migrations\/2026-12-31-cash-membership-period-and-anniversary-safety\.sql/);
  assert.match(anchorPreflight, /begin read only;/i);
  assert.match(anchorPreflight, /rollback;/i);
  assert.match(anchorPreflight, /MISSING_ANCHOR_POSSIBLE_MONTH_END_CLAMP/);
  assert.match(anchorPreflight, /ANCHOR_CONFLICT/);
  assert.match(anchorPreflight, /ORGANISATION_RISK_TOTAL/);
  assert.match(anchorPreflight, /historical_period_evidence/);
  assert.doesNotMatch(anchorPreflight, /\b(?:insert|update|delete|merge|truncate)\s+(?:into\s+)?public\./i);
  assert.doesNotMatch(anchorPreflight, /billing_period_start|billing_period_end|receipt_date|paid_through_date/i);
  assert.match(anchorRunbook, /Stop condition/i);
  assert.match(anchorRunbook, /BranchId/i);
  assert.match(anchorRunbook, /Club Manager/i);
});

test("disposable PostgreSQL harness proves both anniversary guard failures roll back before corrected migration succeeds", () => {
  const prerequisite = postgresHarness.indexOf("psql_db \"$state_c\" --file=supabase/migrations/2026-12-30-member-account-readiness-and-cash-evidence.sql");
  const clone = postgresHarness.indexOf('createdb --maintenance-db=postgres --template="$state_c" "$state_anchor"');
  const migration = postgresHarness.indexOf("psql_db \"$state_c\" --single-transaction --file=supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql");
  assert.ok(prerequisite >= 0 && prerequisite < clone && clone < migration, "guard test DB must clone the state after 12-30 and before the normal 12-31 application");
  assert.match(postgresHarness, /expect_anchor_migration_rejection "missing-anchor" "\$state_anchor" "1 monthly arrangements have missing anchors"/);
  assert.match(postgresHarness, /expect_anchor_migration_rejection "conflicting-obligation-evidence" "\$state_anchor" "1 have conflicting schedule evidence"/);
  assert.match(postgresHarness, /set billing_anchor_day=30[^\n]*coverage_start_at='2024-03-31 10:00:00\+00'/);
  assert.match(postgresHarness, /coverage_start_at='2024-03-30 10:00:00\+00'/);
  assert.ok(postgresHarness.indexOf('expect_anchor_migration_rejection "conflicting-obligation-evidence"') < postgresHarness.indexOf('coverage_start_at=\'2024-03-30 10:00:00+00\''));
  assert.match(postgresHarness, /--set=VERBOSITY=verbose --single-transaction --file=supabase\/migrations\/2026-12-31-cash-membership-period-and-anniversary-safety\.sql/);
  assert.match(postgresHarness, /55000/);
  assert.match(postgresHarness, /anchor_migration_snapshot/);
  assert.match(postgresHarness, /pg_get_constraintdef/);
  assert.match(postgresHarness, /pg_get_triggerdef/);
  assert.match(postgresHarness, /pg_get_functiondef/);
  assert.match(postgresHarness, /Rejected migration partially added billing-period columns/);
  assert.match(postgresHarness, /Rejected migration partially added the period-pair constraint/);
  assert.match(postgresHarness, /member-billing-anchor-migration-guard\.sql/);
  assert.match(postgresHarness, /member-billing-anchor-migration-guard-success\.sql/);

  assert.match(anchorGuardFixture, /'2024-03-30 10:00:00\+00'/);
  assert.match(anchorGuardFixture, /set billing_anchor_day = 30/);
  assert.match(anchorGuardFixture, /monthly/);
  assert.match(anchorGuardSuccessFixture, /billing_period_start/);
  assert.match(anchorGuardSuccessFixture, /club_membership_billing_payment_period_pair_check/);
  assert.match(anchorGuardSuccessFixture, /coverage_start_at/);
});

test("cash payment cannot reset anniversary from receipt time or create renewals for inactive memberships", () => {
  const cashSettlement = migration.slice(
    migration.indexOf("create or replace function public.club_record_membership_cash_payment"),
    migration.indexOf("revoke all on function public.club_record_membership_cash_payment"),
  );
  assert.match(cashSettlement, /club_membership_anniversary\(a\.next_due_at/);
  assert.match(cashSettlement, /membership_row\.status='active'.*a\.state='active'/s);
  assert.match(cashSettlement, /product_billing='recurring'/);
  assert.doesNotMatch(cashSettlement, /next_due:=.*p_receipt_date|next_due:=.*now\(\)/);
  assert.match(migration, /product_billing<>'recurring' or product_duration_days in \(1,7\)/);
  assert.match(migration, /product_billing='recurring' and coalesce\(product_duration_days,0\) not in \(1,7\)/);
  assert.match(migration, /fixed-duration and one-off memberships cannot create monthly billing obligations/i);
  assert.match(fixture, /cash receipt reset household renewal schedule from the received date/i);
  assert.match(fixture, /Expired and cancelled cash memberships/);
  assert.match(fixture, /<>1 then raise exception 'Expired cash settlement created another period obligation'/);
});

test("synthetic PostgreSQL lifecycle fixture covers household recovery, duplicate cash, EOM and fixed passes", () => {
  for (const phrase of [
    "cash-early-jan",
    "cash-on-time-feb",
    "cash-late-mar",
    "2024-02-29",
    "2024-03-31",
    "Day pass created a monthly obligation arrangement",
    "Week pass created a monthly obligation arrangement",
    "household-cash-recovery",
    "Expired and cancelled cash memberships",
    "rollback;",
  ]) assert.ok(fixture.includes(phrase), `household lifecycle fixture is missing ${phrase}`);
});

test("household SQL fixture keeps protected billing reads out of authenticated role except deliberate denials", () => {
  let role = "database owner";
  const restrictedReads: string[] = [];
  const restrictedInternalCalls: string[] = [];
  const protectedTableAccess = /\b(?:from|join|update|insert\s+into|delete\s+from)\s+public\.club_membership_billing_(?:arrangements|obligations|payments)\b/i;
  const restrictedFunctions = /public\.club_membership_anniversary\s*\(/i;

  for (const [index, line] of fixture.split(/\r?\n/).entries()) {
    if (/^\s*set local role authenticated\s*;/i.test(line)) role = "authenticated";
    else if (/^\s*set local role service_role\s*;/i.test(line)) role = "service_role";
    else if (/^\s*reset role\s*;/i.test(line)) role = "database owner";

    if (role === "authenticated" && protectedTableAccess.test(line)) {
      restrictedReads.push(`${index + 1}:${line.trim()}`);
    }
    if (role === "authenticated" && restrictedFunctions.test(line)) {
      restrictedInternalCalls.push(`${index + 1}:${line.trim()}`);
    }
  }

  assert.equal(restrictedReads.length, 3, `unexpected direct billing-table access under authenticated: ${restrictedReads.join(" | ")}`);
  assert.match(restrictedReads[0], /billing_obligations/);
  assert.match(restrictedReads[1], /billing_arrangements/);
  assert.match(restrictedReads[2], /billing_payments/);
  assert.deepEqual(restrictedInternalCalls, [], `restricted anniversary helper called under authenticated: ${restrictedInternalCalls.join(" | ")}`);
  assert.equal((fixture.match(/public\.club_membership_anniversary\s*\(/g) ?? []).length, 2, "anniversary logic should be exercised only in owner setup/assertion contexts");
  assert.equal(role, "database owner", "fixture must reset the session role before rollback");
  assert.match(fixture, /Authenticated user directly read protected billing obligations/);
  assert.match(fixture, /Authenticated user directly read protected billing arrangements/);
  assert.match(fixture, /Authenticated user directly read protected cash evidence/);
  assert.equal((fixture.match(/exception when insufficient_privilege then null; end;/g) ?? []).length, 3);
  assert.match(fixture, /club_list_customer_billing\('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022'\)/);
});

test("disposable PostgreSQL harness reports independent fixture failures together and keeps migration setup fail-fast", () => {
  assert.match(postgresHarness, /psql_db\s+"\$state_c"\s+--file="\$fixture"\s+>"\$log_file"\s+2>&1/);
  assert.match(postgresHarness, /fixture_failures\+=\("\$\{label\}: \$\{sql_error\}"\)/);
  assert.match(postgresHarness, /POSTGRES FIXTURE FAILURE SUMMARY \(\$\{#fixture_failures\[@\]\} failed\):/);
  assert.match(postgresHarness, /exit 1/);
  assert.match(postgresHarness, /psql:\.\*:\[0-9\]\+: \(ERROR\|FATAL\|PANIC\):/);
  assert.doesNotMatch(postgresHarness, /ON_ERROR_STOP=off|set\s+\+e/);
  const fixtureCalls = [
    "Household billing lifecycle",
    "Notification outbox permissions and retry",
    "Notification generation",
    "Staff owner transfer",
    "Club station PIN reauthentication",
    "Active Sports import RPC",
  ].map(label => postgresHarness.indexOf(`run_sql_fixture "${label}"`));
  assert.ok(fixtureCalls.every(position => position >= 0), "each independent SQL fixture should be run through aggregated diagnostics");
  assert.deepEqual(fixtureCalls, [...fixtureCalls].sort((a, b) => a - b), "fixture execution order should remain deterministic");
});

test("access safety facts safely return an absent booking before and after the booking lookup path", () => {
  assert.match(accessSafetyFix, /booking_row public\.club_induction_bookings%rowtype/);
  assert.match(accessSafetyFix, /security definer set search_path=pg_catalog,public/);
  assert.match(accessSafetyFix, /'inductionBooking',case when booking_row\.id is null then null/);
  assert.doesNotMatch(accessSafetyFix, /grant execute on function public\.club_access_safety_facts/);
  assert.match(fixture, /Optional induction booking should be null when no induction policy exists/);
  assert.match(fixture, /Required induction without a booking did not return a safe null booking\/due state/);
});

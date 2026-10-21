import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql", "utf8");
const memberAction = readFileSync("app/club/classes/member-actions.ts", "utf8");
const memberUi = readFileSync("components/club-member-classes.tsx", "utf8");
const packageData = readFileSync("lib/madhouse-catalogue.ts", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const operationsImport = readFileSync("supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql", "utf8");
const stationMigration = readFileSync("supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql", "utf8");
const creditMigration = readFileSync("supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql", "utf8");
const dailyChecks = readFileSync("supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql", "utf8");
const paymentMigration = readFileSync("supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql", "utf8");

test("member booking uses authenticated entitlement, reusable-credit, Stripe, and drop-box server paths", () => {
  assert.match(memberAction, /club_redeem_transformation_class_credit/);
  assert.match(memberAction, /club_redeem_reusable_class_credit/);
  assert.match(memberAction, /club_start_member_payg_class_booking/);
  assert.match(memberAction, /createStripeClassCheckoutSession/);
  assert.match(migration, /create or replace function public\.club_create_class_booking/);
  assert.match(migration, /raise exception 'Class booking is unavailable until verified payment and package entitlements are configured'/);
  assert.doesNotMatch(migration, /insert into public\.club_class_bookings/i);
  assert.match(manifest, /2027-01-04-madhouse-class-booking-fail-closed\.sql/);
});

test("member timetable displays confirmed PAYG options and credit choices", () => {
  assert.match(memberUi, /PAYG price unavailable/);
  assert.match(memberUi, /Use included class/);
  assert.match(memberUi, /Use class credit/);
  assert.match(memberUi, /Stripe · £10/);
  assert.match(memberUi, /Cash · £10 due/);
  assert.doesNotMatch(memberUi, /disabled title=/);
});

test("no membership class entitlement or transformation class credit is inferred", () => {
  assert.doesNotMatch(packageData, /entitlementKey: "class_access"/);
  assert.match(packageData, /pt_session_credit/);
  assert.match(packageData, /entitlementKey: "included_class_credit", scope: "organisation", allowance: \{ quantity: 1, period: "week" \}/);
});

test("weekly operating import is idempotent and preserves the confirmed timetable, rota, and Sunday closure", () => {
  assert.match(operationsImport, /on conflict \(organisation_id,template_key\) do update/);
  assert.equal((operationsImport.match(/'monday-boxing-rotherham'|'tuesday-women-only-carlton'|'wednesday-hiit-carlton'|'wednesday-circuit-rotherham'|'thursday-women-only-rotherham'|'friday-circuit-carlton'/g) ?? []).length, 6);
  assert.match(operationsImport, /duration_minutes integer/);
  assert.match(operationsImport, /effective_from date/);
  assert.match(operationsImport, /'Carlton','sunbeds',7,null,null,'confirmed_closed'/);
  assert.equal((operationsImport.match(/'fa44592a-1593-4ad3-a621-63a4a4bcbceb','(?:monday|tuesday|wednesday|thursday|friday|saturday)-(?:carlton|rotherham)-/g) ?? []).length, 14);
  assert.match(operationsImport, /'friday-carlton-shannon'.*'Shannon'/);
  assert.match(operationsImport, /monthly_addon_active boolean not null default false check \(monthly_addon_active=false\)/);
  for (const [weekday, opens, closes] of [[1,"14:00","20:00"],[2,"14:00","20:00"],[3,"14:00","20:00"],[4,"09:00","20:00"],[5,"09:00","20:00"],[6,"10:00","13:00"]] as const) {
    assert.match(operationsImport, new RegExp(`'Carlton','sunbeds',${weekday},'${opens}','${closes}','confirmed'`));
  }
});

test("check-in location and station label come from the authenticated registered station", () => {
  const action = readFileSync("app/club/access/actions.ts", "utf8");
  const page = readFileSync("app/club/check-in/page.tsx", "utf8");
  const component = readFileSync("components/club-checkin-station.tsx", "utf8");
  assert.match(action, /verifyClubStationSession/);
  assert.match(action, /p_station_id:station\.id,p_station_token:station\.token/);
  const scanAction = action.slice(action.indexOf("export async function checkInStationScanAction"), action.indexOf("export async function decideCustomerAccessAction"));
  assert.doesNotMatch(scanAction, /input\.locationId|input\.stationLabel/);
  assert.match(stationMigration, /s\.location_id/);
  assert.match(stationMigration, /club_reception_access_decision\(s\.organisation_id,s\.location_id/);
  assert.match(stationMigration, /Registered station authentication is required/);
  assert.match(page, /club_shared_station_identity/);
  assert.doesNotMatch(component, /<select|stationLabel.*useState|locationId.*useState/);
});

test("Glow Zone apps and reception read opening hours from one database source", () => {
  for (const file of ["app/member-hub/glow-zone/page.tsx", "app/club/sunbeds/page.tsx", "app/club/access/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /club_location_service_hours/);
    assert.match(source, /GlowZoneOpeningHours/);
  }
  assert.match(operationsImport, /grant select on public\.club_location_service_hours to anon/);
});

test("availability remains server-authoritative and cancellation remains available", () => {
  const sql = readFileSync("supabase/migrations/2026-09-07-club-classes-bookings-services.sql", "utf8");
  assert.match(sql, /select \* into v_session from public\.club_class_sessions where id=p_session_id for update/);
  assert.match(sql, /v_count>=v_session\.capacity/);
  assert.match(sql, /create or replace function public\.club_cancel_class_booking/);
  assert.match(memberAction, /cancelClassBooking/);
});

test("Madhouse capacity is serialized and transformations share the six total seats", () => {
  assert.match(operationsImport, /from public\.club_class_sessions where id=new\.session_id and organisation_id=new\.organisation_id for update/i);
  assert.match(operationsImport, /total_count>=least\(coalesce\(s\.capacity,6\),6\)/i);
  assert.match(operationsImport, /transformation_count>=least\(s\.max_transformation_credit_bookings,2\)/i);
  assert.match(operationsImport, /b\.funding_type='transformation_credit' or b\.entitlement_usage_id is not null/i);
  assert.match(operationsImport, /club_madhouse_class_session_limit/);
  assert.match(paymentMigration, /transformation_count>=least\(coalesce\(s\.max_transformation_credit_bookings,2\),2\)/i);
});

test("cancellations atomically restore the recorded source and remain reportable", () => {
  assert.match(operationsImport, /delete from public\.club_entitlement_usage where id=b\.entitlement_usage_id/);
  assert.match(operationsImport, /entry_type,quantity_delta,balance_after[\s\S]*'refund_restoration',1/);
  assert.match(operationsImport, /club_class_booking_cancellations\(booking_id,organisation_id,funding_type,actor_user_id/);
  assert.match(operationsImport, /club_list_class_booking_cancellations/);
  assert.match(operationsImport, /class-cancel:'\|\|b\.id::text/);
});

test("future transformation credits key off the class ISO week, not booking date", () => {
  const entitlementLogic = creditMigration.slice(creditMigration.indexOf("club_redeem_transformation_class_credit"), creditMigration.indexOf("club_redeem_reusable_class_credit"));
  assert.match(entitlementLogic, /s\.starts_at at time zone 'Europe\/London'/);
  assert.match(entitlementLogic, /extract\(isoyear/);
  assert.match(entitlementLogic, /week_key:=week_year::text\|\|'-W'\|\|lpad\(week_number::text,2,'0'\)/);
  assert.match(creditMigration, /unique\(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number\)/);
  assert.match(entitlementLogic, /This week's included class has already been used/);
  assert.match(creditMigration, /usage_status='restored'/);
  assert.match(creditMigration, /'included-restore:'\|\|b\.id::text/);
});

test("cancellation credits are single-use, expire by cancellation actor, and cannot be extended by cycling", () => {
  assert.match(creditMigration, /now\(\)\+case when user_cancel then interval '1 month' else interval '6 months' end/);
  assert.match(creditMigration, /least\(credit_expiry,expires_at\)/);
  assert.match(creditMigration, /cancellation_booking_id uuid not null unique/);
  assert.match(creditMigration, /expires_at>now\(\)/);
  assert.match(creditMigration, /redeemed_at=now\(\),redeemed_booking_id=booking\.id/);
  assert.match(creditMigration, /class-credit-issue:'\|\|b\.id::text/);
  assert.match(creditMigration, /class-credit-redeem:'\|\|booking\.id::text/);
});

test("Madhouse cleaning tasks seed idempotently into existing daily checks and are due only on schedule", () => {
  assert.match(dailyChecks, /club_madhouse_seed_daily_checks/);
  assert.match(dailyChecks, /club_checklist_templates/);
  assert.match(dailyChecks, /club_checklist_item_checks/);
  assert.match(dailyChecks, /club_checklist_item_source_key_uq/);
  assert.match(dailyChecks, /Empty bins when full/);
  assert.match(dailyChecks, /Deep-clean Carlton sunbed rooms/);
  assert.match(dailyChecks, /Steam-clean mats · Rotherham/);
  assert.match(dailyChecks, /Steam-clean mats · Carlton/);
  assert.match(dailyChecks, /scheduled_weekday=extract\(isodow from cycle\.operational_date\)/);
  assert.match(dailyChecks, /This scheduled check is not due today/);
});

test("Stripe, cash, register, and capacity-pending paths are server authoritative", () => {
  assert.match(paymentMigration, /status in \('confirmed','waitlisted','pending_payment','cash_due'\)/);
  assert.match(paymentMigration, /p_payment_method not in \('stripe','gym_drop_box'\)/);
  assert.match(paymentMigration, /club_record_class_stripe_event/);
  assert.match(paymentMigration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(paymentMigration, /club_record_class_cash_dropbox/);
  assert.match(paymentMigration, /A physical cash reconciliation reference is required/);
  assert.match(paymentMigration, /club_staff_collect_class_cash/);
  assert.match(paymentMigration, /club_get_host_class_register/);
  assert.match(paymentMigration, /club_staff_list_class_members/);
  assert.match(readFileSync("app/api/webhooks/stripe/classes/route.ts", "utf8"), /STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET/);
  assert.match(readFileSync("components/club-class-register.tsx", "utf8"), /Verify drop-box cash/);
  assert.match(readFileSync("components/club-class-register.tsx", "utf8"), /No-show/);
  assert.match(readFileSync("app/club/classes/setup/page.tsx", "utf8"), /ClubClassSetup/);
  assert.match(readFileSync("app/club/classes/setup-actions.ts", "utf8"), /club_madhouse_generate_class_sessions/);
});

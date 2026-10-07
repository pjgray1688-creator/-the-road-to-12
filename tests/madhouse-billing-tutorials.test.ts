import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annualRenewalReminderDates, madhouseCheckoutKind, nextMonthlyAnniversary, paidThrough, recurringGraceEligible } from "../lib/madhouse-billing";
import { coachTutorialSteps, madhouseTutorialSteps, memberTutorialSteps, MEMBER_TUTORIAL_VERSION } from "../lib/tutorials";
import { madhouseCatalogue } from "../lib/madhouse-catalogue";

const migration = readFileSync("supabase/migrations/2026-11-19-madhouse-billing-and-tutorials.sql", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const tutorial = readFileSync("components/tutorial-experience.tsx", "utf8");

test("monthly Madhouse joining requires upfront card payment and recurring Direct Debit authority", () => {
  assert.equal(madhouseCheckoutKind({ priceMinor: 2700, billing: "recurring" }), "monthly_recurring");
  assert.match(migration, /v_checkout='monthly_recurring' then 'card_and_direct_debit'/);
  assert.match(migration, /upfront_provider=case when v_checkout='free' then null else 'stripe'/);
  assert.match(migration, /recurring_provider=case when v_checkout='monthly_recurring' then 'gocardless'/);
  assert.match(migration, /upfront_payment_state='confirmed'.*recurring_authority_state='confirmed'/s);
  assert.match(migration, /Monthly joining fee is not configured/);
});

test("Madhouse public joining does not offer recurring card versus Direct Debit", () => {
  assert.doesNotMatch(joinForm, /<option value="card">/);
  assert.doesNotMatch(joinForm, /<option value="direct_debit">/);
  assert.match(joinForm, /name="paymentMethod" value="card_and_direct_debit"/);
  assert.match(joinForm, /joining fee.*Direct Debit/s);
});

test("day and week passes are one-off exact paid periods", () => {
  assert.equal(madhouseCheckoutKind({ priceMinor: 500, billing: "one_off", durationDays: 1 }), "day_pass");
  assert.equal(madhouseCheckoutKind({ priceMinor: 1200, billing: "one_off", durationDays: 7 }), "week_pass");
  const start = new Date("2026-10-06T10:00:00Z");
  assert.equal(paidThrough(start, 1).toISOString(), "2026-10-07T10:00:00.000Z");
  assert.equal(paidThrough(start, 7).toISOString(), "2026-10-13T10:00:00.000Z");
  assert.match(migration, /p\.duration_days is not null then coalesce\(p_occurred_at,now\(\)\)\+make_interval\(days=>p\.duration_days\)/);
});

test("yearly Madhouse membership is one-off with renewal reminders", () => {
  const yearly = madhouseCatalogue.find(product => product.name === "Yearly Membership");
  assert.equal(yearly?.billing, "one_off"); assert.equal(yearly?.durationDays, 365);
  assert.equal(madhouseCheckoutKind({ priceMinor: 25000, billing: "one_off", durationDays: 365 }), "annual_one_off");
  const reminders = annualRenewalReminderDates(new Date("2027-10-06T10:00:00Z"));
  assert.deepEqual(reminders.map(value => value.toISOString()), ["2027-09-06T10:00:00.000Z", "2027-09-29T10:00:00.000Z", "2027-10-03T10:00:00.000Z"]);
  for (const key of ["annual_renewal_1_month", "annual_renewal_1_week", "annual_renewal_final_days"]) assert.match(migration, new RegExp(key));
});

test("monthly anniversaries preserve the billing day and clamp month ends", () => {
  const january = new Date("2026-01-31T09:00:00Z");
  const february = nextMonthlyAnniversary(january, 31); const march = nextMonthlyAnniversary(february, 31);
  assert.equal(february.toISOString(), "2026-02-28T09:00:00.000Z");
  assert.equal(march.toISOString(), "2026-03-31T09:00:00.000Z");
  assert.match(migration, /billing_anchor_day/); assert.match(migration, /club_membership_anniversary/);
});

test("failed-payment grace belongs only to recurring monthly billing", () => {
  assert.equal(recurringGraceEligible({ billing: "recurring", frequency: "monthly" }), true);
  assert.equal(recurringGraceEligible({ billing: "one_off", frequency: "annual" }), false);
  assert.equal(recurringGraceEligible({ billing: "one_off" }), false);
  assert.match(migration, /new\.frequency<>'monthly' and new\.state='grace'/);
});

test("provider confirmation is trusted, idempotent and does not activate from an opened route", () => {
  assert.match(migration, /club_membership_join_provider_events/);
  assert.match(migration, /unique\(organisation_id,provider_type,provider_event_key\)/);
  assert.match(migration, /grant execute on function public\.club_record_join_provider_event.*to service_role/);
  assert.match(migration, /revoke all on function public\.club_record_join_provider_event.*authenticated/);
  assert.doesNotMatch(joinForm, /payment_state.*confirmed/);
});

test("existing-member claim preserves membership and creates no payment setup", () => {
  const acquisition = readFileSync("supabase/migrations/2026-11-18-member-acquisition-onboarding.sql", "utf8");
  const claim = acquisition.slice(acquisition.indexOf("create or replace function public.club_claim_existing_member"), acquisition.indexOf("create or replace function public.club_staff_link_member_account"));
  assert.match(claim, /club_membership_holders/);
  assert.doesNotMatch(claim, /club_membership_join_requests|club_membership_billing_arrangements|payment_provider/);
});

test("Member tutorial triggers for ready organic users and connected Madhouse members", () => {
  assert.match(migration, /'member_ready',exists\(select 1 from public\.profiles/);
  assert.match(migration, /'madhouse_connected',exists\(select 1 from public\.club_membership_holders/);
  assert.match(tutorial, /context\.member_ready && !done\("member_core"\)/);
  assert.match(tutorial, /context\.madhouse_connected && progress\("member_core"\)\?\.status === "completed" && !done\("madhouse_connected"\)/);
  assert.ok(madhouseTutorialSteps.length > 0);
});

test("tutorial progress is versioned, skippable, non-repeating and replayable", () => {
  assert.equal(MEMBER_TUTORIAL_VERSION, 1);
  assert.match(migration, /primary key\(user_id,tutorial_key,version\)/);
  assert.match(migration, /status in \('completed','skipped'\)/);
  assert.match(tutorial, /finish\("skipped"\)/); assert.match(tutorial, /item\.version === tutorialVersion\(key\)/);
  const account = readFileSync("app/account/page.tsx", "utf8"); const coach = readFileSync("components/coach-workspace.tsx", "utf8");
  assert.match(account, /Replay Member tutorial/); assert.match(account, /Replay Coach tutorial/); assert.doesNotMatch(coach, /Replay Coach tutorial/);
});

test("Member tutorial teaches RIR and the real training concepts", () => {
  assert.ok(memberTutorialSteps.length >= 6 && memberTutorialSteps.length <= 10);
  const content = memberTutorialSteps.map(step => `${step.title} ${step.body}`).join(" ");
  for (const phrase of ["Today", "Warm-up", "working sets", "RIR 3", "RIR 2", "RIR 1", "RIR 0", "rest timer", "Progress", "Recovery"]) assert.match(content, new RegExp(phrase, "i"));
});

test("Coach tutorial requires explicit Coach access and cannot change assignments", () => {
  assert.equal(coachTutorialSteps.length, 5);
  assert.equal((readFileSync("lib/tutorials.ts", "utf8").match(/COACH_TUTORIAL_VERSION = 2/g) ?? []).length, 1);
  assert.match(migration, /p_tutorial_key='coach_core'.*coach_permissions.*active/s);
  const save = migration.slice(migration.indexOf("create or replace function public.r12_save_my_tutorial_progress"));
  assert.doesNotMatch(save, /insert into public\.coach_permissions|update public\.coach_permissions|coach_client_assignments/);
  const content = coachTutorialSteps.map(step => `${step.title} ${step.body}`).join(" ");
  for (const phrase of ["Primary PT", "cover PT", "Run the session", "load, reps and RIR", "substitutions", "Permanent programme"]) assert.match(content, new RegExp(phrase, "i"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasClubCapability } from "../lib/club-capabilities";

const migration = readFileSync("supabase/migrations/2026-12-24-staff-owner-transfer-and-member-activation-queue.sql", "utf8");
const importer = readFileSync("app/club/members/import/actions.ts", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const harness = readFileSync("scripts/validate-coach-nutrition-reconciliation-postgres.sh", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };

test("launch role presets support Keenan Manager+Coach and hybrid PT operational work without overrides", () => {
  for (const role of ["gym_admin", "trainer"] as const) assert.equal(hasClubCapability(role, "members.view"), true);
  assert.equal(hasClubCapability("gym_admin", "staff.permissions_manage"), true);
  assert.equal(hasClubCapability("trainer", "staff.permissions_manage"), false);
  assert.equal(hasClubCapability("gym_staff", "members.view"), true);
  assert.equal(hasClubCapability("owner", "finance.manage"), true);
});

test("import queues activation only after the real execute RPC and leaves queue failure non-fatal", () => {
  const execute = importer.indexOf('rpc("club_execute_member_import_batch"');
  const activation = importer.indexOf('rpc("club_queue_member_import_activations"');
  assert.ok(execute >= 0 && activation > execute);
  assert.match(importer.slice(activation), /catch \{ \/\* Import completion is authoritative/);
  assert.doesNotMatch(importer.slice(0, execute), /club_queue_member_import_activations/);
  assert.match(migration, /b\.status<>'completed'/);
  assert.match(migration, /c\.user_id is not null/);
  assert.match(migration, /member-activation:'\|\|r\.customer_id/);
  assert.match(migration, /p_include_member_activation or template_key<>'member_activation'/);
  assert.match(readFileSync("app/api/internal/notification-worker/route.ts", "utf8"), /R12_MEMBER_ACTIVATION_EMAILS_ENABLED === "true"/);
});

test("member activation resend is capability-gated, idempotent and does not send mail inline", () => {
  assert.match(migration, /club_resend_member_activation_notification/);
  assert.match(migration, /members\.link_account/);
  assert.match(migration, /state not in \('processing','cancelled'\)/);
  assert.match(migration, /revoke all on function public\.club_resend_member_activation_notification/);
});

test("owner transfer is current-owner-only, organisation-scoped, atomic and preserves separate links", () => {
  assert.match(migration, /auth\.uid\(\) and active and role='owner'/);
  assert.match(migration, /organisation_id=p_organisation_id and user_id=p_new_owner_user_id and active/);
  assert.match(migration, /role='gym_admin'/);
  assert.match(migration, /coach_permissions_unchanged/);
  assert.match(migration, /venue_access_unchanged/);
  assert.match(migration, /organisation\.owner_transferred/);
  assert.match(migration, /revoke all on function public\.club_transfer_organisation_owner/);
  assert.match(manifest, /2026-12-24-staff-owner-transfer-and-member-activation-queue\.sql/);
  assert.match(manifest, /2026-12-25-notification-generator-null-safe-auth-lookup\.sql/);
  assert.match(manifest, /2026-12-26-notification-generator-record-alias-safety\.sql/);
  assert.match(harness, /tests\/sql\/staff-owner-transfer\.sql/);
  assert.match(readFileSync("tests/sql/staff-owner-transfer.sql", "utf8"), /Demoted former owner should not retain transfer authority/);
});

test("notification cron is daily and both internal worker schedules use the existing Vercel config", () => {
  const notification = vercel.crons.find(cron => cron.path === "/api/internal/notification-worker");
  assert.ok(notification);
  assert.match(notification.schedule, /^\d+ \d+ \* \* \*$/);
  assert.ok(vercel.crons.some(cron => cron.path === "/api/internal/membership-billing-worker"));
  assert.match(harness, /tests\/sql\/notification-outbox-launch\.sql/);
  assert.match(harness, /2026-12-25-notification-generator-null-safe-auth-lookup\.sql/);
  assert.match(harness, /2026-12-26-notification-generator-record-alias-safety\.sql/);
  assert.match(harness, /tests\/sql\/notification-generation-launch\.sql/);
  assert.match(readFileSync("tests/sql/notification-outbox-launch.sql", "utf8"), /Retryable SMTP failure was not returned/);
});

test("important queued mail schedules a post-response worker nudge through the protected outbox route", () => {
  const staffActions = readFileSync("app/club/staff/actions.ts", "utf8");
  const memberActions = readFileSync("app/club/members/actions.ts", "utf8");
  const importActions = readFileSync("app/club/members/import/actions.ts", "utf8");
  const nudge = readFileSync("lib/notification-nudge.ts", "utf8");
  const createInvite = staffActions.indexOf('rpc("club_create_staff_access_grant"');
  const resendStaffInvite = staffActions.indexOf('rpc("club_resend_staff_invitation"');
  const resendMemberInvite = memberActions.indexOf('rpc("club_resend_member_activation_notification"');
  assert.ok(createInvite >= 0 && staffActions.indexOf("nudgeNotificationWorker()", createInvite) > createInvite);
  assert.ok(resendStaffInvite >= 0 && staffActions.indexOf("nudgeNotificationWorker()", resendStaffInvite) > resendStaffInvite);
  assert.ok(resendMemberInvite >= 0 && memberActions.indexOf("nudgeNotificationWorker()", resendMemberInvite) > resendMemberInvite);
  assert.match(importActions, /activationNotifications\.queued \?\? 0\) > 0\) nudgeNotificationWorker\(\)/);
  assert.match(nudge, /after\(async \(\) =>/);
  assert.match(nudge, /\/api\/internal\/notification-worker/);
  assert.match(nudge, /Bearer \$\{secret\}/);
});

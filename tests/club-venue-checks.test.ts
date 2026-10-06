import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProgress, maintenanceStatusLabel, operationalDateAt } from "../lib/club-checks";

const migration = readFileSync("supabase/migrations/2026-11-20-club-venue-checks-maintenance.sql", "utf8");
const page = readFileSync("app/club/checks/page.tsx", "utf8");
const component = readFileSync("components/club-checks.tsx", "utf8");
const actions = readFileSync("app/club/checks/actions.ts", "utf8");
const bootstrap = readFileSync("supabase/bootstrap/2026-11-20-madhouse-daily-check-template.sql", "utf8");

test("operational staff can complete venue and equipment checks through the work-submit capability", () => {
  assert.match(migration, /club_record_checklist_item/);
  assert.match(migration, /club_record_equipment_check/);
  assert.match(migration, /club_venue_check_access\(p_organisation_id,p_location_id,'staff\.work_submit'\)/);
  assert.match(migration, /club_submit_daily_check/);
  assert.match(component, /Save/);
  assert.match(component, /Submit daily checklist/);
});

test("fault reporting and out-of-service checks create durable maintenance state", () => {
  assert.match(migration, /create table if not exists public\.club_maintenance_issues/);
  assert.match(migration, /create table if not exists public\.club_maintenance_issue_history/);
  assert.match(migration, /p_status in \('issue','out_of_service'\)/);
  assert.match(migration, /operational_status=case when p_status='out_of_service' then 'out_of_service' else 'needs_attention' end/);
  assert.match(component, /out_of_service/);
  assert.match(component, /Report a fault/);
});

test("only management can configure templates and the equipment register or review issues", () => {
  for (const functionName of ["club_checklist_create_template", "club_checklist_assign_template", "club_checklist_save_item", "club_equipment_save_asset", "club_set_maintenance_status", "club_reopen_daily_check"]) {
    const start = migration.indexOf(`function public.${functionName}`);
    assert.ok(start >= 0, `${functionName} exists`);
    const end = migration.indexOf("$$;", start);
    assert.match(migration.slice(start, end), /staff\.work_review/);
  }
  assert.match(component, /MANAGER CONFIGURATION/);
  assert.match(component, /Save maintenance update/);
});

test("out-of-service status is not reset by a new daily cycle and return to service is explicit", () => {
  assert.match(migration, /operational_status text not null default 'operational'/);
  assert.match(migration, /update public\.club_equipment_assets set operational_status=case when p_status='out_of_service'/);
  assert.match(migration, /p_return_to_service/);
  assert.match(migration, /venue\.equipment_returned_to_service/);
  assert.match(migration, /club_checklist_cycles\(organisation_id,location_id,operational_date\)/);
});

test("daily completion is organisation- and venue-scoped and duplicate submission is idempotent", () => {
  assert.match(migration, /unique \(organisation_id, location_id, operational_date\)/);
  assert.match(migration, /where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public\.club_venue_operational_date\(\)/);
  assert.match(migration, /if cycle\.status='submitted' then return to_jsonb\(cycle\)/);
  assert.match(migration, /if item_done<item_total or equipment_done<equipment_total then raise exception/);
  assert.match(page, /club_list_venue_check_overview/);
});

test("operational date is deterministic at the UK venue boundary", () => {
  assert.equal(operationalDateAt(new Date("2026-11-20T23:59:59.000Z")), "2026-11-20");
  assert.equal(operationalDateAt(new Date("2026-11-21T00:01:00.000Z")), "2026-11-21");
  assert.match(migration, /Europe\/London/);
});

test("actor attribution always comes from auth.uid and audit history is exposed without trusting the browser", () => {
  assert.match(migration, /checked_by uuid not null references auth\.users\(id\)/);
  assert.match(migration, /reported_by uuid not null references auth\.users\(id\)/);
  assert.match(migration, /club_append_audit_event\(p_organisation_id/);
  assert.match(migration, /actor_user_id,from_status,to_status/);
  assert.doesNotMatch(actions, /p_actor|actorUserId|actor_user_id/);
  assert.match(component, /View history/);
  assert.match(component, /Checked by/);
});

test("member and guest paths are excluded by server capability checks", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),p_capability\)/);
  assert.match(migration, /grant execute on function public\.club_get_venue_daily_checks.*to authenticated/);
  assert.match(migration, /public\.club_checklist_cycles, public\.club_checklist_item_checks/);
  assert.match(page, /canSubmit/);
});

test("optional media is a reference boundary and does not create an unauthorised upload path", () => {
  assert.match(migration, /media_reference text/);
  assert.match(migration, /p_media_reference/);
  assert.match(component, /Photo reference \(optional\)/);
  assert.doesNotMatch(component, /type="file"/);
  assert.doesNotMatch(migration, /storage\.objects.*insert|create policy.*storage/i);
});

test("Madhouse default checklist bootstrap is explicit, idempotent and does not seed equipment", () => {
  assert.match(bootstrap, /r12\.bootstrap_organisation_id/);
  assert.match(bootstrap, /r12\.bootstrap_actor_id/);
  assert.match(bootstrap, /slug='madhouse-gym'/);
  assert.match(bootstrap, /on conflict\(template_id,location_id\) do nothing/);
  assert.doesNotMatch(bootstrap, /club_equipment_assets/);
  assert.doesNotMatch(bootstrap, /auth\.users.*insert/i);
});

test("progress and status labels remain simple for the operational UI", () => {
  assert.deepEqual(checkProgress(28, 31), { completed: 28, total: 31, percent: 90 });
  assert.equal(maintenanceStatusLabel("awaiting_parts"), "Awaiting Parts");
});

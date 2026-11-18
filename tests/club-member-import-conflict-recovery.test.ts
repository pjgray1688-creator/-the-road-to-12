import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/2027-02-03-club-member-import-conflict-recovery.sql", import.meta.url), "utf8");

test("individual importer infers the nullable assignment-key partial unique index", () => {
  assert.match(sql, /on conflict \(organisation_id,assignment_idempotency_key\) where assignment_idempotency_key is not null\s+do nothing returning \*/i);
  assert.match(sql, /member-import:'\|\|r\.id/);
});

test("import counters come from committed outcomes and errors expose SQLSTATE only", () => {
  assert.match(sql, /count\(\*\) filter\(where outcome='imported'\)/);
  assert.match(sql, /count\(\*\) filter\(where outcome='linked'\)/);
  assert.match(sql, /get stacked diagnostics safe_sqlstate = returned_sqlstate/);
  assert.match(sql, /Import failed safely \(SQLSTATE /);
  assert.doesNotMatch(sql, /get stacked diagnostics[^;]*message_text/i);
  assert.doesNotMatch(sql, /sqlerrm/i);
});

test("recovery is capability-checked, exact-batch guarded, idempotent, and excludes successes", () => {
  assert.match(sql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.import'\)/);
  assert.match(sql, /6bf9d303-525a-4565-88a4-b4121fac7f98/);
  assert.match(sql, /success_count<>225 or imported_count<>16 or linked_count<>209/);
  assert.match(sql, /rejected_count<>477 or target_count<>477/);
  assert.match(sql, /outcome='rejected'\s+and imported_membership_id is null/);
  assert.match(sql, /blockers='\["Import failed safely; review this row"\]'::jsonb/);
  assert.match(sql, /if r\.outcome in \('imported','linked','skipped_existing'\) then skipped:=skipped\+1; continue; end if/);
  assert.match(sql, /success_count=702 and rejected_count=0 and b\.row_count=702/);
  assert.match(sql, /grant execute on function public\.club_recover_rejected_member_import_batch\(uuid,uuid\) to authenticated/);
});

test("recovery wrapper has no direct billing or invitation writes", () => {
  const recovery = sql.slice(sql.indexOf("create or replace function public.club_recover_rejected_member_import_batch"));
  assert.doesNotMatch(recovery, /insert into public\.(club_membership_billing_arrangements|club_membership_billing_obligations|club_membership_join_requests|club_payments|club_member_notification_intents)/i);
  assert.match(sql, /billing_evidence','not_imported'/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-08-notification-claim-recovery.sql", "utf8");

test("a fresh processing lease cannot be reclaimed", () => {
  assert.match(migration, /where state='processing' and \(claimed_until is null or claimed_until<=now\(\)\)/);
  assert.doesNotMatch(migration, /where state='processing'[^;]*claimed_until>now\(\)/);
});

test("expired processing leases are diagnosed and rescheduled until the attempt ceiling", () => {
  assert.match(migration, /set state=case when attempts>=3 then 'failed' else 'scheduled' end/);
  assert.match(migration, /failure_code=case when attempts>=3 then 'claim_lease_expired_max_attempts' else 'claim_lease_expired' end/);
  assert.match(migration, /claimed_by=null,claimed_until=null,updated_at=now\(\)/);
  assert.match(migration, /where state='processing' and \(claimed_until is null or claimed_until<=now\(\)\)/);
});

test("completed intents are terminal and cannot re-enter claim selection", () => {
  assert.match(migration, /where target_email is not null and state in \('pending','scheduled'\)/);
  assert.doesNotMatch(migration, /state in \([^)]*'sent'/);
});

test("claim recovery retains concurrent-worker exclusion and bounded attempts", () => {
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /attempts<3 and not_before<=now\(\)/);
  assert.match(migration, /set state='processing',attempts=n\.attempts\+1/);
  assert.match(migration, /claimed_by=p_worker_id,claimed_until=now\(\)\+interval '10 minutes'/);
});

test("claim recovery is service-role-only and retains safe function search path", () => {
  assert.match(migration, /security definer set search_path=pg_catalog,public/);
  assert.match(migration, /if auth\.role\(\)<>'service_role'/);
  assert.match(migration, /revoke all on function public\.club_claim_notification_intents\(integer,text\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.club_claim_notification_intents\(integer,text\) to service_role/);
});

test("claim recovery is ordered after the existing live POS migration in the launch manifest", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-12-07-club-pos-sellable-units-and-pt-packages.sql") < manifest.indexOf("2026-12-08-notification-claim-recovery.sql"));
});

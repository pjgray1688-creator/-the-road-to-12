import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runbook = readFileSync("docs/madhouse-schema-deployment.md", "utf8");
const bootstrap = readFileSync("docs/manual-sql/madhouse-first-organisation-bootstrap.sql", "utf8");
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
const followUpRelease = readFileSync("supabase/deployment/2026-11-22-r12-launch-follow-up.sql", "utf8");

test("Madhouse runbook gives one controlled deployment and read-only verification path", () => {
  assert.match(runbook, /apply-madhouse-schema\.sh/);
  assert.match(runbook, /r12_schema_migrations/);
  assert.match(runbook, /to_regclass/);
  assert.match(runbook, /club_claim_notification_intents/);
  assert.match(runbook, /Do not run the superseded replay bundle or historical repair migrations manually/);
});

test("first organisation bootstrap requires a verified existing Auth identity", () => {
  assert.match(bootstrap, /email_confirmed_at is not null/);
  assert.match(bootstrap, /REPLACE_WITH_EXISTING_AUTH_USER_UUID/);
  assert.match(bootstrap, /v_grant_coach boolean := false/);
  assert.match(bootstrap, /coach_permissions/);
  assert.match(bootstrap, /on conflict \(organisation_id,user_id\)/i);
  assert.doesNotMatch(bootstrap, /insert into auth\.users/i);
  assert.doesNotMatch(bootstrap, /club_members.*Peter|Keenan|Shan|George|Luke|Amie/is);
});

test("runner cannot silently continue after a migration checksum or SQL failure", () => {
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /Checksum mismatch/);
  assert.match(runner, /exit 4/);
  assert.match(runner, /psql .* -f/);
});

test("follow-up SQL requires only the existing 01-03 through 01-09 chain and accepts all-pending release migrations", () => {
  const preflight = followUpRelease.match(/do \$preflight\$([\s\S]*?)end \$preflight\$;/)?.[1];
  assert.ok(preflight, "release preflight exists");
  const loops = [...preflight.matchAll(/for v_name, v_expected in select \* from \(values([\s\S]*?)\) as (required|included)\(migration_name,checksum\) loop([\s\S]*?)end loop;/g)];
  assert.equal(loops.length, 2);
  const names = (index: number) => [...loops[index][1].matchAll(/\('(supabase\/migrations\/[^']+\.sql)'/g)].map(match => match[1]);
  assert.deepEqual(names(0), [
    "supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql",
    "supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql",
    "supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql",
    "supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql",
    "supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql",
    "supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql",
    "supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql",
  ]);
  assert.deepEqual(names(1), [
    "supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql",
    "supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql",
    "supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql",
    "supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql",
  ]);
  assert.match(loops[0][3], /if v_actual is distinct from v_expected then raise exception/);
  assert.match(loops[1][3], /if v_actual is not null and v_actual<>v_expected then raise exception/);

  // These assertions mirror the SQL branch: NULL is allowed for each pending
  // migration, but a present checksum must match the source migration.
  const rejectsIncludedChecksum = (actual: string | null, expected: string) => actual !== null && actual !== expected;
  assert.equal(names(1).every(() => !rejectsIncludedChecksum(null, "source-checksum")), true);
  assert.equal(rejectsIncludedChecksum("wrong-checksum", "source-checksum"), true);
  assert.equal(rejectsIncludedChecksum("source-checksum", "source-checksum"), false);
});

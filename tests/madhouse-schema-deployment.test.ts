import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runbook = readFileSync("docs/madhouse-schema-deployment.md", "utf8");
const bootstrap = readFileSync("docs/manual-sql/madhouse-first-organisation-bootstrap.sql", "utf8");
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");

test("Madhouse runbook gives one controlled deployment and read-only verification path", () => {
  assert.match(runbook, /apply-madhouse-schema\.sh/);
  assert.match(runbook, /r12_schema_migrations/);
  assert.match(runbook, /to_regclass/);
  assert.match(runbook, /club_claim_notification_intents/);
  assert.match(runbook, /Do not run the old migration files manually/);
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


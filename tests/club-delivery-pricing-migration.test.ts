import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-18-club-delivery-pricing.sql", import.meta.url), "utf8");
const verification = readFileSync(new URL("../docs/sql/verify-club-delivery-pricing.sql", import.meta.url), "utf8");

test("delivery migration uses dedicated organisation-scoped idempotency", () => {
  assert.match(migration, /add column if not exists idempotency_key text/i);
  assert.match(migration, /club_inventory_receipts_org_idempotency_uidx/i);
  assert.match(migration, /idempotency_key=v_idempotency/i);
  assert.doesNotMatch(migration, /notes\s*=\s*concat\('\[idempotency:/i);
});

test("delivery migration validates lines before posting and keeps receipt atomic", () => {
  assert.match(migration, /positive integer/i);
  assert.match(migration, /unit cost must be a nonnegative integer/i);
  assert.match(migration, /VAT rate is invalid/i);
  assert.match(migration, /security definer/i);
});

test("verification SQL is read-only", () => {
  assert.doesNotMatch(verification, /\b(insert|update|delete|call)\b/i);
  assert.match(verification, /club_receive_inventory_delivery/i);
  assert.match(verification, /rls_enabled/i);
});

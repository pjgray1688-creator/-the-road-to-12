import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/2026-09-25-club-madhouse-balance.sql";

function balanceMigration() {
  assert.ok(existsSync(migrationPath), `Expected ${migrationPath} for the Madhouse Balance slice`);
  return readFileSync(migrationPath, "utf8");
}

function commerceMigration() {
  return readFileSync("supabase/migrations/2026-09-08-club-commerce-payments-inventory.sql", "utf8") +
    readFileSync("supabase/migrations/2026-09-09-club-cash-credits-promotions.sql", "utf8") + balanceMigration();
}

test("Madhouse Balance migration keeps a ledger and separate gym revenue boundary", () => {
  const sql = commerceMigration();
  assert.match(sql, /club_balance_accounts/);
  assert.match(sql, /club_balance_entries/);
  assert.match(sql, /entry_type/);
  assert.match(sql, /top_up/);
  assert.match(sql, /purchase/);
  assert.match(sql, /club_payments/);
  assert.match(sql, /method\s*=?.*balance|method.*'balance'/i);
  assert.match(sql, /not.*R12|R12.*separate|platform-revenue/i);
});

test("Balance top-up and spend are trusted, organisation-scoped, and idempotent", () => {
  const sql = balanceMigration();
  for (const fn of ["club_record_balance_cash_top_up", "club_staff_spend_balance"]) {
    const start = sql.indexOf(`create or replace function public.${fn}`);
    assert.notEqual(start, -1, `${fn} must have a final production definition`);
    const next = sql.indexOf("create or replace function public.", start + 10);
    const body = sql.slice(start, next === -1 ? undefined : next);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path\s*=\s*pg_catalog,public/);
    assert.match(body, /organisation_id/);
    assert.match(body, /idempotency/);
    assert.match(body, /for update|transaction|lock/i);
  }
  const topUp = sql.slice(sql.indexOf("create or replace function public.club_record_balance_cash_top_up"), sql.indexOf("create or replace function public.club_staff_spend_balance"));
  assert.match(topUp, /club_cash_declarations/);
  assert.match(topUp, /club_balance_entries/);
  assert.match(topUp, /club_payments/);
});

test("Balance credit rejects invalid/negative amounts and spend cannot overdraw", () => {
  const sql = balanceMigration();
  const creditStart = sql.indexOf("create or replace function public.club_record_balance_cash_top_up");
  const spendStart = sql.indexOf("create or replace function public.club_staff_spend_balance");
  assert.ok(creditStart >= 0 && spendStart > creditStart);
  const credit = sql.slice(creditStart, spendStart);
  const spend = sql.slice(spendStart);
  assert.match(credit, /p_amount_minor\s*<=\s*0|amount_minor\s*<=\s*0/);
  assert.match(spend, /insufficient|balance.*<|amount_delta_minor.*sum/i);
  assert.match(spend, /p_amount_minor\s*<=\s*0|amount_minor\s*<=\s*0/);
});

test("Top-up and balance purchase preserve distinct financial events", () => {
  const sql = commerceMigration();
  assert.match(sql, /balance_top_up/);
  assert.match(sql, /club_cash_declarations/);
  assert.match(sql, /cash/);
  assert.match(sql, /top.?up[\s\S]{0,300}balance|balance[\s\S]{0,300}purchase/i);
});

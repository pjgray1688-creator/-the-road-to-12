import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-11-05-madhouse-apparel-quote.sql", "utf8");

test("quote migration reuses public publication price and website size authority", () => {
  assert.match(migration, /club_website_shop_publications/);
  assert.match(migration, /website_price_minor/);
  assert.match(migration, /website_available_sizes\s+@>/);
  assert.match(migration, /w\.published\s+and\s+w\.available\s+and\s+w\.mapping_verified/);
  assert.match(migration, /club_website_shop_family_settings/);
  assert.match(migration, /p\.active/);
});

test("quote uses configured R12 bundle promotion and exact public delivery, with no order writes", () => {
  assert.match(migration, /club_promotions/);
  assert.match(migration, /bundle_price_minor/);
  assert.match(migration, /repeatable/);
  assert.match(migration, /delivery_minor',395/);
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.club_orders\b/i);
  assert.doesNotMatch(migration, /\bupdate\s+public\.club_website_shop_publications\b/i);
  assert.match(migration, /revoke all on function public\.club_quote_madhouse_apparel_checkout\(jsonb\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.club_quote_madhouse_apparel_checkout\(jsonb\) to service_role/i);
});

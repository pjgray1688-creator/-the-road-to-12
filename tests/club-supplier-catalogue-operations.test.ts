import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-09-24-club-supplier-catalogue-operations.sql", "utf8");
const component = readFileSync("components/club-supplier-catalogue.tsx", "utf8");
const shop = readFileSync("components/club-shop.tsx", "utf8");

test("supplier offers require review and dual capability before publication", () => {
  assert.match(migration, /club_list_supplier_catalogue/);
  assert.match(migration, /supplier\.catalogue_manage/);
  assert.match(migration, /commerce\.pricing_manage/);
  assert.match(migration, /p_retail_price_minor<=0/);
  assert.match(migration, /Choose one supplier offer/);
  assert.match(migration, /sellable=true/);
});

test("catalogue UI supports review, link/create and explicit publication", () => {
  assert.match(component, /Create product/);
  assert.match(component, /Publish/);
  assert.match(component, /supplier_cost|wholesale_cost_minor/);
  assert.match(component, /retail_price_minor/);
});

test("member shop labels non-stock catalogue products as available to order without supplier internals", () => {
  assert.match(shop, /Available to Order/);
  assert.match(shop, /Search products/);
  assert.doesNotMatch(shop, /wholesale_cost_minor|supplier_availability|supplier_sku/);
});

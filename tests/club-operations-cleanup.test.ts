import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p:string) => readFileSync(p, "utf8");

test("stock and retail product lists use ten-row pagination", () => {
  assert.match(read("components/club-stock-panel.tsx"), /Stock pagination/);
  assert.match(read("components/club-stock-panel.tsx"), /pageRows/);
  assert.match(read("components/club-supplier-pricing.tsx"), /slice\(\(currentPage - 1\) \* 10, currentPage \* 10\)/);
  assert.doesNotMatch(read("components/club-supplier-pricing.tsx"), /Show 50 more/);
});

test("shop sub-pages have Back to Shop and Promotions stays in Shop administration", () => {
  assert.match(read("app/club/shop/balance/page.tsx"), /Back to Shop/);
  assert.match(read("app/club/shop/collections/page.tsx"), /Back to Shop/);
  assert.match(read("app/club/shop/supplier-catalogue/page.tsx"), /Back to Shop/);
  assert.match(read("components/club-shop-tabs.tsx"), />Promotions</);
  assert.doesNotMatch(read("app/club/payments/page.tsx"), /club\/promotions/);
  assert.doesNotMatch(read("app/club/payments/page.tsx"), /canManagePromotions/);
});

test("staff management is consolidated under Management", () => {
  assert.match(read("app/club/more/page.tsx"), /Staff &amp; permissions/);
  assert.match(read("app/club/more/page.tsx"), /\/club\/staff/);
  assert.match(read("components/club-shell.tsx"), /label: "Management"/);
  assert.doesNotMatch(read("components/club-shell.tsx"), /label: "More"/);
});

test("the real Active Sports importer remains on Supplier Catalogue only", () => {
  assert.match(read("app/club/shop/supplier-catalogue/page.tsx"), /ActiveSportsImport/);
  assert.match(read("components/club-supplier-pricing.tsx"), /showImporter/);
});

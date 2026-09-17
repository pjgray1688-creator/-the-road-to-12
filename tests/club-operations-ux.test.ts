import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("club navigation keeps commerce management inside Shop", () => {
  const nav = read("components/club-shell.tsx");
  const tabs = read("components/club-shop-tabs.tsx");
  assert.doesNotMatch(nav, /\["Products & Pricing"/);
  assert.doesNotMatch(nav, /\["Services"/);
  assert.doesNotMatch(nav, /\["Promotions"/);
  assert.match(tabs, /Products &amp; Pricing/);
  assert.match(tabs, /Promotions/);
});

test("products and catalogue surfaces use ten-card pagination and full-result filters", () => {
  const pricing = read("components/club-supplier-pricing.tsx");
  const catalogue = read("components/club-supplier-catalogue.tsx");
  assert.match(pricing, /slice\(\(currentPage - 1\) \* 10, currentPage \* 10\)/);
  assert.match(pricing, /setPage\(1\)/);
  assert.doesNotMatch(pricing, /Show 50 more/);
  assert.match(catalogue, /const PAGE_SIZE = 10/);
  assert.match(catalogue, /setPage\(1\)/);
  assert.doesNotMatch(catalogue, /Show 50 more/);
});

test("supplier catalogue puts weekly updates before the parent browser and removes demo stock", () => {
  const page = read("app/club/shop/supplier-catalogue/page.tsx");
  const gsn = read("components/club-gsn-import.tsx");
  assert.ok(page.indexOf("WEEKLY CATALOGUE UPDATES") < page.indexOf("<ClubSupplierCatalogue"));
  assert.doesNotMatch(gsn, /demo stock|Load GSN demo stock/i);
  assert.doesNotMatch(read("app/club/shop/supplier-catalogue/actions.ts"), /loadGsnDemoStockAction/);
});

test("Glow Zone uses the retained verification record and never bypasses missing status", () => {
  const actions = read("app/club/sunbeds/actions.ts");
  const ui = read("components/club-sunbed-operations.tsx");
  assert.match(actions, /club_glow_age_status/);
  assert.match(read("supabase/migrations/2026-09-17-glow-age-status-read.sql"), /club_glow_age_verifications/);
  assert.match(ui, /AGE STATUS UNAVAILABLE/);
  assert.match(ui, /age === "verified"/);
  assert.match(ui, /verifyGlowAgeAction/);
});

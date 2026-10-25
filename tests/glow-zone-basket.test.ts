import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GLOW_PAYG_MAX_MINUTES, glowBasketTotal, normaliseGlowPaygMinutes } from "../lib/glow-zone-basket";

test("Glow Zone basket validates PAYG minutes", () => {
  assert.equal(normaliseGlowPaygMinutes("8.9"), 8);
  assert.equal(normaliseGlowPaygMinutes(0), 1);
  assert.equal(normaliseGlowPaygMinutes("not-a-number"), 1);
  assert.equal(normaliseGlowPaygMinutes(9999), GLOW_PAYG_MAX_MINUTES);
});

test("Glow Zone basket totals packages and per-minute purchases in minor units", () => {
  assert.equal(glowBasketTotal([{ quantity: 2, priceMinor: 1500 }, { quantity: 7, priceMinor: 100 }]), 3700);
});

test("Glow Zone purchase and account surfaces stay non-transactional and identity-scoped", () => {
  const basket = readFileSync("components/glow-zone-basket.tsx", "utf8");
  const account = readFileSync("app/api/glow-zone/account/route.ts", "utf8");
  assert.match(basket, /Pay by card — Coming soon/);
  assert.match(basket, /disabled/);
  assert.doesNotMatch(basket, /fetch\(|stripe|grant.*minute/i);
  assert.match(account, /client\.auth\.getUser\(\)/);
  assert.match(account, /\.eq\("user_id", user\.id\)/);
  assert.match(account, /isGlowZoneReviewer\(user\)[\s\S]*ageStatus: "required"/);
  assert.doesNotMatch(account, /ageStatus: "verified".*isGlowZoneReviewer/s);
});

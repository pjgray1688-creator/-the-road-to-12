import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-05-member-shop-card-order-ownership.sql", "utf8");
const orderCreation = readFileSync("supabase/migrations/2026-10-01-club-promotions-engine.sql", "utf8");
const paymentAttempt = readFileSync("supabase/migrations/2026-09-27-club-payment-attempts-split-tender.sql", "utf8");
const shop = readFileSync("components/club-shop.tsx", "utf8");
const styles = readFileSync("components/club-shop.module.css", "utf8");
const families = readFileSync("lib/club-product-families.ts", "utf8");

test("member card order preparation binds only the authenticated creator's pending member_app order", () => {
  assert.match(orderCreation, /case when v_staff then null else auth\.uid\(\) end,p_channel,'pending_payment'/);
  assert.match(migration, /o\.created_by=auth\.uid\(\)/);
  assert.match(migration, /user_id=auth\.uid\(\),updated_at=now\(\)/);
  assert.match(migration, /o\.user_id is distinct from auth\.uid\(\)/);
  assert.match(migration, /o\.status<>'pending_payment'/);
  assert.match(migration, /o\.organisation_id is distinct from p_organisation_id/);
  assert.match(migration, /o\.location_id is distinct from p_location_id/);
  assert.match(migration, /grant execute on function public\.club_begin_stripe_commerce_attempt\(uuid,uuid,jsonb,text\) to authenticated/);
  assert.match(migration, /madhouse_products_services/);
  assert.match(migration, /stripe_product_id is not null and p\.stripe_price_id is not null/);
  assert.match(paymentAttempt, /v_order\.user_id is distinct from auth\.uid\(\)/);
});

test("member shop modals lock page scrolling and contain their own safe-area-aware scrolling", () => {
  assert.match(shop, /body\.style\.position = "fixed"/);
  assert.match(shop, /body\.style\.top = `-\$\{scrollY\}px`/);
  assert.match(shop, /window\.scrollTo\(0, scrollY\)/);
  assert.match(shop, /className=\{styles\.shopModal\}/);
  assert.match(styles, /\.shopModal \.sheet\{[^}]*max-height:calc\(100dvh/);
  assert.match(styles, /overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch/);
  assert.match(styles, /\.sheet>:global\(\.primary\.full\)\{position:sticky/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
});

test("floating basket is portalled to the viewport and hidden behind open dialogs", () => {
  assert.match(shop, /createPortal\([\s\S]*className=\{styles\.floatingBasket\}/);
  assert.match(shop, /basketQuantity > 0 && !modalOpen/);
  assert.match(styles, /\.floatingBasket\{position:fixed/);
  assert.match(styles, /bottom:calc\(90px \+ env\(safe-area-inset-bottom\)\)/);
});

test("normal basket copy is distinct from genuine Google Play demo copy", () => {
  assert.match(shop, /item\.name\} added to \$\{demoMode \? "demo basket" : "basket"\}/);
  assert.match(shop, /Google Play review · demo catalogue/);
  assert.doesNotMatch(shop, /Secure checkout with Madhouse Products and Services Limited/);
  assert.doesNotMatch(shop, /\(Products and Services\)/);
});

test("transformation package ordering is Gold, Silver, Bronze without changing product data", () => {
  assert.match(families, /\["transformation gold", 0\], \["transformation silver", 1\], \["transformation bronze", 2\]/);
  assert.match(families, /return sortedCards\.map\(card => isTransformationPackage\(card\) \? orderedPackages\[packageIndex\+\+\] : card\)/);
});

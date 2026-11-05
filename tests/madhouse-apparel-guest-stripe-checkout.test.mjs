import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checkout = readFileSync("app/api/public/madhouse-apparel/checkout/route.ts", "utf8");
const merchantSql = readFileSync("supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql", "utf8");
const guestCheckoutSql = readFileSync("supabase/migrations/2026-11-05-madhouse-apparel-guest-checkout.sql", "utf8");
const apparelSql = readFileSync("supabase/migrations/2026-11-04-madhouse-apparel-orders.sql", "utf8");
const webhook = readFileSync("app/api/webhooks/stripe/products-services/route.ts", "utf8");

test("guest Apparel checkout creates a payment-mode session without creating a Stripe Customer", () => {
  assert.doesNotMatch(checkout, /stripe_customer_creation|\/customers/);
  assert.match(checkout, /mode:"payment", customer_email:String\(customer\.email\)\.trim\(\)\.toLowerCase\(\), customer_creation:"if_required"/);
  assert.doesNotMatch(checkout, /customer_update\[/);
  assert.match(checkout, /"shipping_address_collection\[allowed_countries\]\[0\]":"GB"/);
  assert.match(checkout, /"payment_method_types\[0\]":"card"/);
  assert.match(checkout, /assertStripeLiveCheckoutEnabled\(merchant, config\.mode\)/);
  assert.match(checkout, /stripeMerchantForCategory\("other_product_or_service"\)/);
});

test("Checkout Session total is checked against the prepared R12 order before linking", () => {
  assert.match(checkout, /session\.amount_total!==prepared\.total_minor/);
  assert.match(checkout, /p_customer_id:stripeCustomerId/);
  assert.match(checkout, /typeof session\.customer === "string" \? session\.customer : session\.customer\?\.id \?\? null/);
});

test("session linking accepts a null customer and keeps the existing payment attempt/session references", () => {
  assert.match(merchantSql, /p_attempt_id uuid,p_account_id text,p_session_id text,p_customer_id text/);
  assert.match(merchantSql, /\(p_customer_id is not null and p_customer_id !~ '\^cus_'\)/);
  assert.match(merchantSql, /stripe_customer_id=coalesce\(stripe_customer_id,p_customer_id\)/);
  assert.match(merchantSql, /where id=p_attempt_id and status='pending' and stripe_merchant_entity='madhouse_products_services'/);
  assert.match(merchantSql, /stripe_checkout_session_id=coalesce\(stripe_checkout_session_id,p_session_id\)/);
});

test("payment webhook reconciliation remains tied to the attempt and deduplicated order lifecycle", () => {
  assert.match(webhook, /club_record_stripe_commerce_event/);
  assert.match(webhook, /club_mark_madhouse_apparel_paid/);
  assert.match(webhook, /p_attempt_id: attemptId/);
  assert.match(apparelSql, /where organisation_id=org and idempotency_key=p_idempotency_key/);
  assert.match(apparelSql, /on conflict\(order_id,event_key,recipient_email\) do nothing/);
  assert.match(guestCheckoutSql, /create or replace function public\.club_record_stripe_commerce_event/);
  assert.match(guestCheckoutSql, /p_status is distinct from 'paid' or p_payment_intent_id is null or p_amount_minor<>a\.external_amount_minor/);
  assert.doesNotMatch(guestCheckoutSql, /p_payment_intent_id is null or p_customer_id is null/);
  assert.match(guestCheckoutSql, /if found then return jsonb_build_object\('duplicate',true\)/);
  assert.match(guestCheckoutSql, /grant execute on function public\.club_record_stripe_commerce_event[\s\S]*to service_role/);
});

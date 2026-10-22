import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readStripeMerchantConfig, stripeApiKeyMatchesMode } from "../lib/stripe-merchant";
import { createStripeCommerceCheckoutSession } from "../lib/stripe-commerce-provider";
import { appBaseUrlStatus } from "../lib/site-url";
import { inspectStripeReadiness } from "../lib/stripe-readiness-diagnostic";

const migration = readFileSync("supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql", "utf8");
const categoryGuardMigration = readFileSync("supabase/migrations/2027-01-16-stripe-merchant-category-guards.sql", "utf8");
const franchiseWebhook = readFileSync("app/api/webhooks/stripe/route.ts", "utf8");
const productsWebhook = readFileSync("app/api/webhooks/stripe/products-services/route.ts", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const joinAction = readFileSync("app/club/join/actions.ts", "utf8");
const commerceAction = readFileSync("app/club/shop/actions.ts", "utf8");
const localTestScript = readFileSync("scripts/stripe-test-local.sh", "utf8");
const localTestRunbook = readFileSync("docs/r12-stripe-local-test-runbook.md", "utf8");

const productsEnv = {
  NODE_ENV: "test",
  STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "sk_test_productsonly",
  STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET: "whsec_products_only",
  STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID: "acct_products",
  STRIPE_PRODUCTS_SERVICES_MODE: "test",
} as NodeJS.ProcessEnv;

test("merchant config requires separate entity-specific credentials and never falls back", () => {
  const franchiseEnv = {
    STRIPE_FRANCHISE_SECRET_KEY: "sk_test_franchiseonly",
    STRIPE_FRANCHISE_WEBHOOK_SECRET: "whsec_franchise_only",
    STRIPE_FRANCHISE_ACCOUNT_ID: "acct_franchise",
    STRIPE_FRANCHISE_MODE: "test",
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv;
  assert.equal(readStripeMerchantConfig("madhouse_franchise", franchiseEnv).legalEntityNumber, "17383077");
  assert.equal(readStripeMerchantConfig("madhouse_products_services", productsEnv).legalEntityNumber, "17383213");
  assert.throws(() => readStripeMerchantConfig("madhouse_franchise", productsEnv), /configuration is incomplete/);
  assert.throws(() => readStripeMerchantConfig("madhouse_products_services", { ...productsEnv, STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "sk_live_wrongmode" }), /does not match its configured mode/);
});

test("restricted and standard Stripe keys accept matching modes and reject malformed or mismatched keys", () => {
  for (const mode of ["live", "test"] as const) {
    for (const kind of ["sk", "rk"] as const) {
      const key = `${kind}_${mode}_A1b2C3d4E5`;
      assert.equal(stripeApiKeyMatchesMode(key, mode), true);
      assert.equal(stripeApiKeyMatchesMode(key, mode === "live" ? "test" : "live"), false);
    }
  }
  for (const malformed of ["rk_live_", "sk_test_short", "rk_live_bad key", "rk_live_bad_key", "pk_live_A1b2C3d4E5", "sk_mode_A1b2C3d4E5"]) {
    assert.equal(stripeApiKeyMatchesMode(malformed, "live"), false, malformed);
  }
  const liveRestricted = { ...productsEnv, STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "rk_live_A1b2C3d4E5", STRIPE_PRODUCTS_SERVICES_MODE: "live" };
  assert.equal(readStripeMerchantConfig("madhouse_products_services", liveRestricted).mode, "live");
  const testRestricted = { ...productsEnv, STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "rk_test_A1b2C3d4E5" };
  assert.equal(readStripeMerchantConfig("madhouse_products_services", testRestricted).mode, "test");
});

test("Stripe readiness diagnostic separates binding, key authentication and self-account permission safely", async () => {
  const env = {
    NODE_ENV: "test",
    STRIPE_FRANCHISE_SECRET_KEY: "rk_live_franchisefixture", STRIPE_FRANCHISE_WEBHOOK_SECRET: "whsec_franchisefixture", STRIPE_FRANCHISE_ACCOUNT_ID: "acct_franchise", STRIPE_FRANCHISE_MODE: "live",
    STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "rk_live_productfixture", STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET: "whsec_productfixture", STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET: "whsec_classfixture", STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID: "acct_products", STRIPE_PRODUCTS_SERVICES_MODE: "live",
  } as NodeJS.ProcessEnv;
  const requests: Array<{ url: string; method: string }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const accountId = authorization.includes("franchisefixture") ? "acct_franchise" : "acct_products";
    return Response.json({ id: accountId, company: { name: accountId === "acct_franchise" ? "Madhouse Franchise Limited" : "Madhouse Products & Services Limited" }, email: "must-not-be-returned@example.test", settings: { sensitive: true } });
  }) as typeof fetch;
  const result = await inspectStripeReadiness(env, fetcher);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url === "https://api.stripe.com/v1/account" && request.method === "GET"));
  assert.equal(result.accountIdsDistinct, "yes");
  assert.equal(result.classWebhookSecret, "configured");
  assert.ok(result.merchants.every(merchant => merchant.providerIdentityMatch === "confirmed" && merchant.accountBinding === "missing" && merchant.keyAuthentication === "accepted" && merchant.checkoutPermission === "not_tested"));
  assert.match(JSON.stringify(result), /Checkout Sessions: Write/);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-returned|Madhouse Franchise Limited|rk_live_|whsec_|acct_franchise|acct_products/);

  const denied = await inspectStripeReadiness(env, (async () => Response.json({ error: { type: "invalid_request_error", code: "more_permissions_required", missing_permissions: ["rak_account_read"], message: "private provider detail" } }, { status: 403 })) as typeof fetch);
  assert.ok(denied.merchants.every(merchant => merchant.accountBinding === "missing" && merchant.keyAuthentication === "accepted" && merchant.selfAccountRead === "permission_denied"));
  assert.ok(denied.merchants.every(merchant => merchant.selfAccountReadError?.kind === "stripe_api" && merchant.selfAccountReadError.status === 403 && merchant.selfAccountReadError.type === "invalid_request_error" && merchant.selfAccountReadError.code === "more_permissions_required" && merchant.selfAccountReadError.missingPermission === "rak_account_read"));
  assert.doesNotMatch(JSON.stringify(denied), /private provider detail/);

  const rejected = await inspectStripeReadiness(env, (async () => Response.json({ error: { type: "authentication_error", code: "invalid_api_key", message: "private provider detail" } }, { status: 401 })) as typeof fetch);
  assert.ok(rejected.merchants.every(merchant => merchant.keyAuthentication === "rejected" && merchant.selfAccountRead === "unavailable"));
  assert.doesNotMatch(JSON.stringify(rejected), /private provider detail/);

  const networkFailure = await inspectStripeReadiness(env, (async () => { throw new TypeError("fetch failed with Authorization: secret"); }) as typeof fetch);
  assert.ok(networkFailure.merchants.every(merchant => merchant.selfAccountReadError?.kind === "network" && merchant.keyAuthentication === "unknown"));
  assert.doesNotMatch(JSON.stringify(networkFailure), /Authorization|secret/);
});

test("Stripe test credentials are allowed only on an explicit Vercel Preview and Preview return URLs stay on that deployment", () => {
  const preview = {
    NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "r12-launch-preview.vercel.app",
    NEXT_PUBLIC_SITE_URL: "https://the-road-to-12.vercel.app",
    STRIPE_FRANCHISE_SECRET_KEY: "sk_test_preview", STRIPE_FRANCHISE_WEBHOOK_SECRET: "whsec_preview",
    STRIPE_FRANCHISE_ACCOUNT_ID: "acct_preview", STRIPE_FRANCHISE_MODE: "test",
  } as NodeJS.ProcessEnv;
  assert.equal(readStripeMerchantConfig("madhouse_franchise", preview).mode, "test");
  assert.deepEqual(appBaseUrlStatus(preview), {
    status: "configured", source: "VERCEL_URL", effectiveUrl: "https://r12-launch-preview.vercel.app",
  });
  assert.equal(appBaseUrlStatus({ ...preview, VERCEL_URL: "https://evil.example/path" }).status, "invalid");
  const production = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://the-road-to-12.vercel.app" } as NodeJS.ProcessEnv;
  assert.deepEqual(appBaseUrlStatus(production), {
    status: "invalid", source: "NEXT_PUBLIC_SITE_URL", effectiveUrl: "https://app.r12.live",
    detail: "Production callbacks use https://app.r12.live; update the configured production site URL to this origin.",
  });
  assert.deepEqual(appBaseUrlStatus({ ...production, NEXT_PUBLIC_SITE_URL: "https://app.r12.live" }), {
    status: "configured", source: "NEXT_PUBLIC_SITE_URL", effectiveUrl: "https://app.r12.live",
  });
  assert.throws(() => readStripeMerchantConfig("madhouse_franchise", { ...preview, VERCEL_ENV: "production" }), /must use live mode/);
  assert.throws(() => readStripeMerchantConfig("madhouse_franchise", { ...preview, VERCEL_ENV: undefined }), /must use live mode/);
});

test("local Stripe end-to-end helper is test-only, loopback-bound, and never links to hosted Supabase", () => {
  assert.match(localTestScript, /STRIPE_FRANCHISE_MODE:-\}" != "test"/);
  assert.match(localTestScript, /sk_test_\*/);
  assert.match(localTestScript, /api\.stripe\.com\/v1\/account/);
  assert.match(localTestScript, /Refusing database URL that is not the isolated local Supabase stack/);
  assert.match(localTestScript, /Refusing Supabase API URL that is not loopback/);
  assert.match(localTestScript, /r12-stripe-local/);
  assert.match(localTestScript, /launch-migrations\.txt/);
  assert.doesNotMatch(localTestScript, /supabase (?:link|db reset|db push).*--linked/);
  assert.match(localTestRunbook, /real GoTrue Auth/);
  assert.match(localTestRunbook, /stripe listen/);
  assert.match(localTestRunbook, /do not run `vercel env pull`/);
  assert.match(localTestRunbook, /home location.*both sites/i);
});

test("Products and Services Checkout validates its account, Product/Price and exact total before creating the session", async () => {
  const saved = Object.fromEntries(Object.keys(productsEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, productsEnv);
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1", ""); calls.push(path);
    if (path === "/account") return new Response(JSON.stringify({ id: "acct_products", company: { name: "Madhouse Products & Services Limited" } }));
    if (path === "/prices/price_supplement") return new Response(JSON.stringify({ id: "price_supplement", active: true, currency: "gbp", unit_amount: 1250, product: "prod_supplement" }));
    if (path === "/checkout/sessions") {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(new Headers(init?.headers).get("idempotency-key"), "r12-commerce-attempt-1");
      assert.equal(body.get("mode"), "payment");
      assert.equal(body.get("line_items[0][price]"), "price_supplement");
      assert.equal(body.get("line_items[0][quantity]"), "2");
      assert.equal(body.get("metadata[merchant_entity]"), "madhouse_products_services");
      return new Response(JSON.stringify({ id: "cs_test_order", url: "https://checkout.stripe.test/cs_test_order", mode: "payment", status: "open", payment_status: "unpaid", amount_total: 2500, payment_intent: null, customer: "cus_products" }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const session = await createStripeCommerceCheckoutSession({ attemptId: "attempt-1", orderId: "order-1", userId: "user-1", customerEmail: "member@example.test", totalMinor: 2500, currency: "GBP", successUrl: "https://app.test/member-hub/shop?payment=processing", cancelUrl: "https://app.test/member-hub/shop?payment=cancelled", lines: [{ productId: "local-product", stripeProductId: "prod_supplement", stripePriceId: "price_supplement", quantity: 2, unitPriceMinor: 1250, currency: "GBP" }] }, fetcher);
    assert.equal(session.id, "cs_test_order");
    assert.deepEqual(calls, ["/account", "/prices/price_supplement", "/checkout/sessions"]);

    const wrongAccount = (async (url: string | URL | Request) => String(url).endsWith("/account") ? new Response(JSON.stringify({ id: "acct_franchise", company: { name: "Madhouse Franchise Limited" } })) : new Response("{}")) as typeof fetch;
    await assert.rejects(createStripeCommerceCheckoutSession({ attemptId: "attempt-2", orderId: "order-2", userId: "user-1", customerEmail: "member@example.test", totalMinor: 1250, currency: "GBP", successUrl: "https://app.test", cancelUrl: "https://app.test", lines: [{ productId: "local-product", stripeProductId: "prod_supplement", stripePriceId: "price_supplement", quantity: 1, unitPriceMinor: 1250, currency: "GBP" }] }, wrongAccount), /account identity does not match configuration/);
    const wrongLegalEntity = (async (url: string | URL | Request) => String(url).endsWith("/account") ? new Response(JSON.stringify({ id: "acct_products", company: { name: "Madhouse Franchise Limited" } })) : new Response("{}")) as typeof fetch;
    await assert.rejects(createStripeCommerceCheckoutSession({ attemptId: "attempt-3", orderId: "order-3", userId: "user-1", customerEmail: "member@example.test", totalMinor: 1250, currency: "GBP", successUrl: "https://app.test", cancelUrl: "https://app.test", lines: [{ productId: "local-product", stripeProductId: "prod_supplement", stripePriceId: "price_supplement", quantity: 1, unitPriceMinor: 1250, currency: "GBP" }] }, wrongLegalEntity), /account identity does not match configuration/);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("membership stays one cross-site Madhouse plan; home gym is optional preference, never payment/access scope", () => {
  assert.match(joinForm, /Home gym.*optional/s);
  assert.match(joinForm, /every Madhouse membership includes Rotherham and Carlton/i);
  assert.match(joinForm, /Madhouse membership plan/i);
  assert.match(joinAction, /p_home_location_id: input\.locationId \?\? null/);
  assert.match(migration, /club_start_membership_joining_optional_home_location/);
  assert.match(migration, /p\.duration_days>=365/);
  assert.match(migration, /Annual Madhouse joining fee is not configured/);
  assert.match(migration, /upfront_amount_minor=first_period_minor\+v_joining_fee/);
  assert.match(migration, /Madhouse memberships require a configured paid plan/);
  assert.match(migration, /revoke all on function public\.club_start_membership_joining\(.*authenticated/);
  assert.match(migration, /new\.scope:='organisation'; new\.location_ids:='\{\}'/);
  assert.match(migration, /stripe_merchant_entity is distinct from p_merchant_entity or r\.stripe_account_id is distinct from p_account_id/);
  assert.match(migration, /club_record_stripe_membership_event_for_account/);
  assert.doesNotMatch(joinAction, /home_location.*stripe|stripe.*home_location/i);
});

test("Franchise checkout binding, preparation and webhook fulfilment reject non-membership products", () => {
  assert.match(categoryGuardMigration, /p\.kind<>'membership'/i);
  assert.match(categoryGuardMigration, /product\.kind='membership'/i);
  assert.match(categoryGuardMigration, /Franchise Stripe events cannot fulfil transformation or service products/i);
  assert.match(categoryGuardMigration, /create or replace function public\.club_prepare_stripe_membership_attempt/i);
  assert.match(categoryGuardMigration, /create or replace function public\.club_bind_stripe_join_account/i);
  assert.match(categoryGuardMigration, /create or replace function public\.club_record_stripe_membership_event_for_account/i);
  assert.doesNotMatch(categoryGuardMigration, /update public\.club_(?:payments|memberships|entitlement_grants|product_entitlements)\s+set/i);
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8").trim().split(/\r?\n/);
  assert.equal(manifest.at(-4), "supabase/migrations/2027-01-16-stripe-merchant-category-guards.sql");
  assert.equal(manifest.at(-2), "supabase/migrations/2027-01-18-controlled-stripe-live-tests.sql");
  assert.equal(manifest.at(-1), "supabase/migrations/2027-01-19-controlled-stripe-live-test-admins.sql");
});

test("signed webhook routes and durable event ledger are isolated by legal merchant/account", () => {
  assert.match(franchiseWebhook, /readStripeMerchantConfig\("madhouse_franchise"\)/);
  assert.match(franchiseWebhook, /club_record_stripe_membership_event_for_account/);
  assert.match(productsWebhook, /readStripeMerchantConfig\("madhouse_products_services"\)/);
  assert.match(productsWebhook, /club_record_stripe_commerce_event/);
  assert.match(migration, /provider_event_key text not null unique/);
  assert.match(migration, /club_payment_attempts_stripe_session_uq/);
  assert.match(migration, /club_payment_attempts_stripe_intent_uq/);
  assert.match(migration, /p_status is distinct from 'paid'/);
  assert.match(migration, /p_occurred_at/);
  assert.match(commerceAction, /payment=processing/);
  assert.match(productsWebhook, /checkout\.session\.async_payment_succeeded/);
  assert.match(productsWebhook, /payment_intent\.payment_failed/);
  assert.match(productsWebhook, /charge\.dispute\.created/);
  const classWebhook = readFileSync("app/api/webhooks/stripe/classes/route.ts", "utf8");
  assert.match(classWebhook, /STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET/);
  assert.match(classWebhook, /verifyStripeSignature/);
  assert.match(franchiseWebhook, /verifyStripeSignature/);
  assert.match(productsWebhook, /verifyStripeSignature/);
});

test("Stripe operations use separate merchant keys and the only checkout-expiry writes are explicit", () => {
  const joinProvider = readFileSync("lib/stripe-join-provider.ts", "utf8");
  const commerceProvider = readFileSync("lib/stripe-commerce-provider.ts", "utf8");
  assert.match(joinProvider, /stripeMerchantRequest<StripeCheckoutSession>\("madhouse_franchise", `\/checkout\/sessions\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(joinProvider, /\/checkout\/sessions\/\$\{encodeURIComponent\(id\)\}\/expire/);
  assert.match(joinProvider, /stripeMerchantForCategory\("class_booking"\)/);
  assert.match(commerceProvider, /stripeMerchantRequest<StripeCommercePrice>\("madhouse_products_services", `\/prices\//);
  assert.match(commerceProvider, /\/checkout\/sessions\/\$\{encodeURIComponent\(id\)\}\/expire/);
  assert.match(commerceProvider, /stripeMerchantForCategory\("other_product_or_service"\)/);
  assert.match(joinProvider, /\/charges\//);
  assert.match(joinProvider, /\/invoices\//);
  assert.match(commerceProvider, /\/payment_intents\//);
  assert.match(commerceProvider, /\/charges\//);
});

test("Stripe merchant diagnostic page is private to owner and gym admin and explicitly read-only", () => {
  const page = readFileSync("app/club/launch-readiness/stripe/page.tsx", "utf8");
  const diagnostic = readFileSync("lib/stripe-readiness-diagnostic.ts", "utf8");
  assert.match(page, /\["owner", "gym_admin"\]/);
  assert.match(page, /hasPlayReviewerEntitlement/);
  assert.match(page, /no session is created/);
  assert.match(diagnostic, /"\/account"/);
  assert.match(diagnostic, /does not use Connect's \/v1\/accounts\/:id/);
  assert.match(diagnostic, /checkoutPermissionChecks: "not_performed_read_only_only"/);
  assert.doesNotMatch(diagnostic, /stripeMerchantRequest[^\n]*method:\s*"POST"/);
});

test("duplicate, superseded, failed, and out-of-order events cannot settle the wrong commerce payment", () => {
  assert.match(migration, /provider_event_key text not null unique/);
  assert.match(migration, /if found then return jsonb_build_object\('duplicate',true\)/);
  assert.match(migration, /a\.stripe_merchant_entity<>p_merchant_entity or a\.stripe_account_id is distinct from p_account_id/);
  assert.match(migration, /a\.stripe_checkout_session_id is distinct from p_session_id/);
  assert.match(migration, /a\.stripe_payment_intent_id<>p_payment_intent_id/);
  assert.match(migration, /if p_event_type='checkout_paid' then[\s\S]*?p_status is distinct from 'paid'[\s\S]*?p_amount_minor<>a\.external_amount_minor/);
  assert.match(migration, /p_event_type in \('checkout_failed','checkout_expired'\) and a\.status='pending'/);
  assert.match(migration, /p_occurred_at>=payment\.stripe_last_refund_at/);
  assert.match(migration, /p_occurred_at>=payment\.stripe_last_dispute_at/);
  assert.match(migration, /p_attempt_generation<>r\.stripe_checkout_generation/);
  assert.match(migration, /r\.stripe_customer_id<>p_customer_id/);
  assert.match(migration, /unique index if not exists club_join_stripe_account_intent_uq/);
});

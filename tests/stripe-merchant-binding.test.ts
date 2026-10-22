import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { inspectStripeMerchantBinding, stripeMerchantApiKeyFingerprint, stripeMerchantBindingMessage, verifyStripeMerchantAccount, type StripeMerchantBinding, type StripeMerchantEntity } from "../lib/stripe-merchant";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function environment(entity: StripeMerchantEntity, accountId: string, overrides: Record<string, string> = {}) {
  const isFranchise = entity === "madhouse_franchise";
  const prefix = isFranchise ? "STRIPE_FRANCHISE" : "STRIPE_PRODUCTS_SERVICES";
  const secretKey = `rk_live_${isFranchise ? "Franchise" : "Products"}Fixture123`;
  const binding: StripeMerchantBinding = {
    version: 1, entity, accountId,
    legalEntityNumber: isFranchise ? "17383077" : "17383213",
    legalEntityName: isFranchise ? "Madhouse Franchise Limited" : "Madhouse Products and Services Limited",
    apiKeyFingerprint: stripeMerchantApiKeyFingerprint(secretKey),
    approvedAt: "2026-10-22T12:00:00.000Z", approvedBy: "Keenan Freer (owner)",
    evidenceReference: `stripe-dashboard-check-${isFranchise ? "franchise" : "products"}-2026-10-22`,
  };
  const signature = sign(null, Buffer.from(stripeMerchantBindingMessage(binding)), privateKey).toString("base64");
  return {
    NODE_ENV: "production", VERCEL_ENV: "production",
    STRIPE_ACCOUNT_BINDING_PUBLIC_KEY: publicPem,
    [`${prefix}_SECRET_KEY`]: secretKey,
    [`${prefix}_WEBHOOK_SECRET`]: "whsec_testfixture",
    [`${prefix}_ACCOUNT_ID`]: accountId,
    [`${prefix}_MODE`]: "live",
    [`${prefix}_ACCOUNT_BINDING`]: JSON.stringify(binding),
    [`${prefix}_ACCOUNT_BINDING_SIGNATURE`]: signature,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("live merchant verification accepts only the exact signed entity/account/legal identity binding", async () => {
  for (const [entity, account] of [["madhouse_franchise", "acct_franchise"], ["madhouse_products_services", "acct_products"]] as const) {
    const env = environment(entity, account);
    assert.equal(inspectStripeMerchantBinding(entity, env).status, "verified");
    let called = false;
    const config = await verifyStripeMerchantAccount(entity, (async () => { called = true; throw new Error("must not request Stripe account identity for live restricted key"); }) as typeof fetch, env);
    assert.equal(config.accountId, account);
    assert.equal(called, false);
  }
});

test("live binding fails closed when missing, altered, mismatched or signed by another key", () => {
  const valid = environment("madhouse_franchise", "acct_franchise");
  const missing = { ...valid, STRIPE_FRANCHISE_ACCOUNT_BINDING: undefined } as NodeJS.ProcessEnv;
  assert.equal(inspectStripeMerchantBinding("madhouse_franchise", missing).status, "missing");
  assert.equal(inspectStripeMerchantBinding("madhouse_franchise", { ...valid, STRIPE_FRANCHISE_ACCOUNT_ID: "acct_products" }).status, "mismatch");
  assert.equal(inspectStripeMerchantBinding("madhouse_franchise", { ...valid, STRIPE_FRANCHISE_SECRET_KEY: "rk_live_anotherKey123" }).status, "mismatch");

  const altered = { ...valid, STRIPE_FRANCHISE_ACCOUNT_BINDING: valid.STRIPE_FRANCHISE_ACCOUNT_BINDING?.replace("Keenan Freer", "Unknown") } as NodeJS.ProcessEnv;
  assert.equal(inspectStripeMerchantBinding("madhouse_franchise", altered).status, "invalid");
  const swapped = { ...valid, STRIPE_FRANCHISE_ACCOUNT_BINDING: environment("madhouse_products_services", "acct_franchise").STRIPE_PRODUCTS_SERVICES_ACCOUNT_BINDING } as NodeJS.ProcessEnv;
  assert.ok(["invalid", "mismatch"].includes(inspectStripeMerchantBinding("madhouse_franchise", swapped).status));
});

test("live checkout identity verification rejects unsigned bindings before any provider request", async () => {
  const env = environment("madhouse_products_services", "acct_products", { STRIPE_PRODUCTS_SERVICES_ACCOUNT_BINDING_SIGNATURE: "" });
  let called = false;
  await assert.rejects(verifyStripeMerchantAccount("madhouse_products_services", (async () => { called = true; return Response.json({}); }) as typeof fetch, env), /account binding is missing/);
  assert.equal(called, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { appBaseUrlStatus } from "../lib/site-url";
import { launchReadiness } from "../lib/launch-readiness";

test("app URL prefers R12_APP_BASE_URL and rejects the landing domain", () => {
  assert.deepEqual(appBaseUrlStatus({ NODE_ENV: "production", R12_APP_BASE_URL: "https://app.example.test", NEXT_PUBLIC_SITE_URL: "https://legacy.example.test" } as NodeJS.ProcessEnv), {
    status: "configured", source: "R12_APP_BASE_URL", effectiveUrl: "https://app.example.test",
  });
  const invalid = appBaseUrlStatus({ R12_APP_BASE_URL: "https://r12.live/account", NODE_ENV: "production" } as NodeJS.ProcessEnv);
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.effectiveUrl, "https://the-road-to-12.vercel.app");
});

test("launch readiness reports missing and invalid settings without returning their values", () => {
  const checks = launchReadiness({
    NODE_ENV: "production", R12_APP_BASE_URL: "https://the-road-to-12.vercel.app", STRIPE_SECRET_KEY: "sk_test_private",
    STRIPE_WEBHOOK_SECRET: "whsec_private", GOCARDLESS_ENVIRONMENT: "production", GOCARDLESS_ACCESS_TOKEN: "token_private",
  } as NodeJS.ProcessEnv);
  assert.equal(checks.find(check => check.key === "stripeSecret")?.state, "invalid");
  assert.equal(checks.find(check => check.key === "goCardlessEnvironment")?.state, "invalid");
  assert.equal(checks.find(check => check.key === "billingWorker")?.state, "missing");
  assert.equal(checks.find(check => check.key === "emailProvider")?.state, "missing");
  assert.doesNotMatch(JSON.stringify(checks), /private|whsec|token_private/);
});

test("production launch checklist documents canonical webhook, callback, and worker URLs", async () => {
  const { readFile } = await import("node:fs/promises");
  const checklist = await readFile("docs/r12-launch-configuration.md", "utf8");
  for (const route of ["/api/webhooks/stripe", "/api/webhooks/gocardless", "/api/club/join/gocardless/complete", "/api/internal/membership-billing-worker", "0 * * * *"]) assert.ok(checklist.includes(route));
});

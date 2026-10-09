import assert from "node:assert/strict";
import test from "node:test";
import { appBaseUrlStatus } from "../lib/site-url";
import { launchReadiness } from "../lib/launch-readiness";
import { inspectSmtpConfiguration } from "../lib/smtp-config";

const env = (values: Record<string, string> = {}) => ({ NODE_ENV: "test", ...values }) as NodeJS.ProcessEnv;

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
  assert.equal(checks.find(check => check.key === "emailProvider")?.state, "adapter_unavailable");
  assert.doesNotMatch(JSON.stringify(checks), /private|whsec|token_private/);
});

test("SMTP configuration accepts an authenticated required-STARTTLS relay without exposing secrets", () => {
  const config = env({
    SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
    SMTP_USERNAME: "private-user", SMTP_PASSWORD: "private-password",
  });
  const result = inspectSmtpConfiguration(config);
  assert.equal(result.state, "configured");
  assert.equal(result.configuration?.port, 587);
  assert.equal(result.configuration?.secure, false);
  assert.equal(result.configuration?.requireTLS, true);
  assert.equal(result.configuration?.from.members.address, "members@r12.live");
  const readiness = launchReadiness(config);
  assert.doesNotMatch(JSON.stringify(readiness), /private-user|private-password/);
  assert.equal(readiness.find(check => check.key === "smtpAuth")?.state, "configured");
  assert.equal(readiness.find(check => check.key === "emailProvider")?.state, "adapter_unavailable");
});

test("SMTP readiness distinguishes missing required config and malformed host, port, and TLS mode", () => {
  assert.equal(inspectSmtpConfiguration(env()).checks.find(check => check.key === "smtpHost")?.state, "missing");
  for (const port of ["abc", "0", "65536"]) {
    const result = inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: port, SMTP_SECURE: "true" }));
    assert.equal(result.checks.find(check => check.key === "smtpPort")?.state, "invalid");
  }
  assert.equal(inspectSmtpConfiguration(env({ SMTP_HOST: "https://smtp.example.test", SMTP_PORT: "465", SMTP_SECURE: "true" })).checks.find(check => check.key === "smtpHost")?.state, "invalid");
  assert.equal(inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_SECURE: "TRUE" })).checks.find(check => check.key === "smtpSecure")?.state, "invalid");
  assert.equal(inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false" })).checks.find(check => check.key === "smtpSecure")?.state, "configured");
  assert.equal(inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "true" })).checks.find(check => check.key === "smtpSecure")?.state, "invalid");
});

test("SMTP authentication credentials must be paired and sender addresses validated", () => {
  const partial = inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USERNAME: "user" }));
  assert.equal(partial.state, "invalid");
  assert.equal(partial.checks.find(check => check.key === "smtpAuth")?.state, "invalid");
  const sender = inspectSmtpConfiguration(env({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_SECURE: "true", R12_EMAIL_FROM_MEMBERS: "not-an-address" }));
  assert.equal(sender.checks.find(check => check.key === "smtpSenderMembers")?.state, "invalid");
  assert.equal(sender.checks.find(check => check.key === "smtpSenderStaff")?.state, "configured");
  assert.equal(sender.checks.find(check => check.key === "smtpSenderBilling")?.state, "configured");
});

test("production launch checklist documents canonical webhook, callback, and worker URLs", async () => {
  const { readFile } = await import("node:fs/promises");
  const checklist = await readFile("docs/r12-launch-configuration.md", "utf8");
  for (const route of ["/api/webhooks/stripe", "/api/webhooks/gocardless", "/api/club/join/gocardless/complete", "/api/internal/membership-billing-worker", "0 * * * *"]) assert.ok(checklist.includes(route));
});

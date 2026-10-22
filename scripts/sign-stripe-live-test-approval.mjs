#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { sign, createPrivateKey } from "node:crypto";

const [entity, approvalPath, privateKeyPath] = process.argv.slice(2);
if (!(entity === "madhouse_franchise" || entity === "madhouse_products_services") || !approvalPath || !privateKeyPath) {
  console.error("Usage: node scripts/sign-stripe-live-test-approval.mjs <merchant-entity> <approval.json> <offline-ed25519-private-key.pem>");
  process.exit(2);
}
try {
  const fields = ["version", "purpose", "entity", "accountId", "observedDashboardName", "observedAccountHolder", "legalEntityTransition", "legalEntityVerified", "apiKeyFingerprint", "amountMinor", "currency", "approvedAt", "approvedBy", "evidenceReference"];
  const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
  const expectedName = entity === "madhouse_franchise" ? "Madhouse Gym Rotherham" : "Madhouse Gym Carlton";
  if (!approval || typeof approval !== "object" || Array.isArray(approval)
    || Object.keys(approval).sort().join(",") !== [...fields].sort().join(",")
    || approval.version !== 1 || approval.purpose !== "r12_controlled_live_payment_test" || approval.entity !== entity
    || !/^acct_[A-Za-z0-9]+$/.test(approval.accountId) || approval.observedDashboardName !== expectedName
    || typeof approval.observedAccountHolder !== "string" || !/^[^\r\n]{3,160}$/.test(approval.observedAccountHolder.trim())
    || approval.legalEntityTransition !== "pending" || approval.legalEntityVerified !== false
    || !/^[a-f0-9]{64}$/.test(approval.apiKeyFingerprint) || approval.amountMinor !== 100 || approval.currency !== "GBP"
    || !Number.isFinite(Date.parse(approval.approvedAt)) || !/^[^\r\n]{3,160}$/.test(approval.approvedBy)
    || !/^[A-Za-z0-9._:/-]{3,160}$/.test(approval.evidenceReference)) throw new Error("invalid approval");
  const canonical = JSON.stringify(Object.fromEntries(fields.map(field => [field, approval[field]])));
  const signature = sign(null, Buffer.from(canonical, "utf8"), createPrivateKey(readFileSync(privateKeyPath))).toString("base64");
  process.stdout.write(`${signature}\n`);
} catch {
  console.error("Approval record or offline signing key is invalid");
  process.exit(1);
}

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { sign, createPrivateKey } from "node:crypto";

const [entity, bindingPath, privateKeyPath] = process.argv.slice(2);
if (!(["madhouse_franchise", "madhouse_products_services"].includes(entity)) || !bindingPath || !privateKeyPath) {
  console.error("Usage: node scripts/sign-stripe-account-binding.mjs <madhouse_franchise|madhouse_products_services> <binding.json> <offline-ed25519-private-key.pem>");
  process.exit(2);
}

try {
  const fields = ["version", "entity", "accountId", "legalEntityNumber", "legalEntityName", "apiKeyFingerprint", "approvedAt", "approvedBy", "evidenceReference"];
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || Object.keys(binding).sort().join(",") !== [...fields].sort().join(",")
    || binding.version !== 1 || binding.entity !== entity
    || !/^acct_[A-Za-z0-9]+$/.test(binding.accountId)
    || !/^\d{8}$/.test(binding.legalEntityNumber)
    || !/^[a-f0-9]{64}$/.test(binding.apiKeyFingerprint)
    || !Number.isFinite(Date.parse(binding.approvedAt))
    || !/^[^\r\n]{3,160}$/.test(binding.approvedBy)
    || !/^[A-Za-z0-9._:/-]{3,160}$/.test(binding.evidenceReference)) {
    throw new Error("Binding record is invalid or incomplete");
  }
  const expected = entity === "madhouse_franchise"
    ? { number: "17383077", name: "Madhouse Franchise Limited" }
    : { number: "17383213", name: "Madhouse Products and Services Limited" };
  const canonicalName = value => value.toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd)\b/g, " ").replace(/[^a-z]/g, "");
  if (binding.legalEntityNumber !== expected.number || canonicalName(binding.legalEntityName) !== canonicalName(expected.name)) {
    throw new Error("Binding legal entity does not match the selected merchant");
  }
  const message = JSON.stringify(Object.fromEntries(fields.map(field => [field, binding[field]])));
  const signature = sign(null, Buffer.from(message, "utf8"), createPrivateKey(readFileSync(privateKeyPath))).toString("base64");
  process.stdout.write(`${signature}\n`);
} catch {
  console.error("Binding record or offline signing key is invalid");
  process.exit(1);
}

import { createHash, verify as verifySignature } from "node:crypto";

export type StripeMerchantEntity = "madhouse_franchise" | "madhouse_products_services";
export type StripeMerchantConfig = {
  entity: StripeMerchantEntity;
  label: string;
  legalEntityNumber: "17383077" | "17383213";
  secretKey: string;
  webhookSecret: string;
  accountId: string;
  mode: "test" | "live";
};

export type StripeMerchantBinding = {
  version: 1;
  entity: StripeMerchantEntity;
  accountId: string;
  legalEntityNumber: "17383077" | "17383213";
  legalEntityName: string;
  apiKeyFingerprint: string;
  approvedAt: string;
  approvedBy: string;
  evidenceReference: string;
};
export type StripeMerchantBindingStatus = "verified" | "missing" | "invalid" | "mismatch";

/** Separate, narrowly scoped attestation for the two owner-initiated £1 tests.
 * It records the observed Dashboard destination during a pending company-name
 * transition; it is deliberately not a legal-entity binding. */
export type StripeLiveTestApproval = {
  version: 1;
  purpose: "r12_controlled_live_payment_test";
  entity: StripeMerchantEntity;
  accountId: string;
  observedDashboardName: string;
  observedAccountHolder: string;
  legalEntityTransition: "pending";
  legalEntityVerified: false;
  apiKeyFingerprint: string;
  amountMinor: 100;
  currency: "GBP";
  approvedAt: string;
  approvedBy: string;
  evidenceReference: string;
};
export type StripeLiveTestApprovalStatus = "verified" | "missing" | "invalid" | "mismatch";

export type StripeSafeApiError = {
  status: number;
  type?: string;
  code?: string;
  missingPermission?: string;
};

export class StripeMerchantApiError extends Error {
  readonly safe: StripeSafeApiError;

  constructor(label: string, safe: StripeSafeApiError) {
    super(`${label} Stripe request failed (HTTP ${safe.status})`);
    this.name = "StripeMerchantApiError";
    this.safe = safe;
  }
}
export class StripeMerchantNetworkError extends Error {
  constructor(label: string) {
    super(`${label} Stripe request failed (network)`);
    this.name = "StripeMerchantNetworkError";
  }
}

function safeStripeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function safeStripePermission(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  return ["accounts_read", "account_read", "accounts_write", "account_write", "rak_accounts_read", "rak_account_read", "connect_accounts_read", "connect_account_read"].includes(normalized) ? normalized : undefined;
}

const contracts = {
  madhouse_franchise: {
    label: "Madhouse Franchise Limited",
    legalEntityNumber: "17383077",
    key: "STRIPE_FRANCHISE_SECRET_KEY",
    webhook: "STRIPE_FRANCHISE_WEBHOOK_SECRET",
    account: "STRIPE_FRANCHISE_ACCOUNT_ID",
    mode: "STRIPE_FRANCHISE_MODE",
    binding: "STRIPE_FRANCHISE_ACCOUNT_BINDING",
    bindingSignature: "STRIPE_FRANCHISE_ACCOUNT_BINDING_SIGNATURE",
  },
  madhouse_products_services: {
    label: "Madhouse Products and Services Limited",
    legalEntityNumber: "17383213",
    key: "STRIPE_PRODUCTS_SERVICES_SECRET_KEY",
    webhook: "STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET",
    account: "STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID",
    mode: "STRIPE_PRODUCTS_SERVICES_MODE",
    binding: "STRIPE_PRODUCTS_SERVICES_ACCOUNT_BINDING",
    bindingSignature: "STRIPE_PRODUCTS_SERVICES_ACCOUNT_BINDING_SIGNATURE",
  },
} as const;

const bindingFields = ["version", "entity", "accountId", "legalEntityNumber", "legalEntityName", "apiKeyFingerprint", "approvedAt", "approvedBy", "evidenceReference"] as const;
const expectedLegalNames: Record<StripeMerchantEntity, string> = {
  madhouse_franchise: "Madhouse Franchise Limited",
  madhouse_products_services: "Madhouse Products and Services Limited",
};
const liveTestApprovals = {
  madhouse_franchise: { record: "STRIPE_FRANCHISE_LIVE_TEST_APPROVAL", signature: "STRIPE_FRANCHISE_LIVE_TEST_APPROVAL_SIGNATURE", dashboardName: "Madhouse Gym Rotherham" },
  madhouse_products_services: { record: "STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL", signature: "STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL_SIGNATURE", dashboardName: "Madhouse Gym Carlton" },
} as const;
const liveTestApprovalFields = ["version", "purpose", "entity", "accountId", "observedDashboardName", "observedAccountHolder", "legalEntityTransition", "legalEntityVerified", "apiKeyFingerprint", "amountMinor", "currency", "approvedAt", "approvedBy", "evidenceReference"] as const;

export function stripeLiveTestApprovalMessage(approval: StripeLiveTestApproval): string {
  return JSON.stringify(Object.fromEntries(liveTestApprovalFields.map(field => [field, approval[field]])));
}

export function stripeLiveTestApprovalSignature(entity: StripeMerchantEntity, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[liveTestApprovals[entity].signature]?.trim();
}

export function inspectStripeLiveTestApproval(entity: StripeMerchantEntity, env: NodeJS.ProcessEnv = process.env): { status: StripeLiveTestApprovalStatus; approval?: StripeLiveTestApproval } {
  const setting = liveTestApprovals[entity];
  const raw = env[setting.record]?.trim();
  const signature = env[setting.signature]?.trim();
  const publicKey = env.STRIPE_ACCOUNT_BINDING_PUBLIC_KEY?.trim();
  if (!raw || !signature || !publicKey) return { status: "missing" };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { status: "invalid" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid" };
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== [...liveTestApprovalFields].sort().join(",")) return { status: "invalid" };
  const approval = value as unknown as StripeLiveTestApproval;
  if (approval.version !== 1 || approval.purpose !== "r12_controlled_live_payment_test" || approval.entity !== entity
    || !/^acct_[A-Za-z0-9]+$/.test(approval.accountId)
    || typeof approval.observedDashboardName !== "string" || !/^[^\r\n]{3,100}$/.test(approval.observedDashboardName)
    || typeof approval.observedAccountHolder !== "string" || !/^[^\r\n]{3,160}$/.test(approval.observedAccountHolder.trim())
    || approval.legalEntityTransition !== "pending" || approval.legalEntityVerified !== false
    || typeof approval.apiKeyFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(approval.apiKeyFingerprint)
    || approval.amountMinor !== 100 || approval.currency !== "GBP"
    || typeof approval.approvedAt !== "string" || !Number.isFinite(Date.parse(approval.approvedAt))
    || typeof approval.approvedBy !== "string" || !/^[^\r\n]{3,160}$/.test(approval.approvedBy.trim())
    || typeof approval.evidenceReference !== "string" || !/^[A-Za-z0-9._:/-]{3,160}$/.test(approval.evidenceReference.trim())) return { status: "invalid" };
  const contract = contracts[entity];
  if (approval.accountId !== env[contract.account]?.trim()
    || approval.observedDashboardName !== setting.dashboardName
    || approval.apiKeyFingerprint !== stripeMerchantApiKeyFingerprint(env[contract.key]?.trim() ?? "")) return { status: "mismatch", approval };
  try {
    const bytes = Buffer.from(signature, "base64");
    if (!bytes.length || bytes.toString("base64") !== signature
      || !verifySignature(null, Buffer.from(stripeLiveTestApprovalMessage(approval), "utf8"), publicKey, bytes)) return { status: "invalid" };
  } catch { return { status: "invalid" }; }
  return { status: "verified", approval };
}

/** Stable signed representation. The offline approver signs exactly this canonical JSON string. */
export function stripeMerchantBindingMessage(binding: StripeMerchantBinding): string {
  return JSON.stringify(Object.fromEntries(bindingFields.map(field => [field, binding[field]])));
}

export function stripeMerchantApiKeyFingerprint(secretKey: string): string {
  return createHash("sha256").update(secretKey, "utf8").digest("hex");
}

export function inspectStripeMerchantBinding(
  entity: StripeMerchantEntity,
  env: NodeJS.ProcessEnv = process.env,
): { status: StripeMerchantBindingStatus; binding?: StripeMerchantBinding } {
  const contract = contracts[entity];
  const configured = env[contract.binding]?.trim();
  const signature = env[contract.bindingSignature]?.trim();
  const publicKey = env.STRIPE_ACCOUNT_BINDING_PUBLIC_KEY?.trim();
  if (!configured || !signature || !publicKey) return { status: "missing" };

  let parsed: unknown;
  try { parsed = JSON.parse(configured); } catch { return { status: "invalid" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid" };
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== [...bindingFields].sort().join(",")) return { status: "invalid" };
  const binding = value as unknown as StripeMerchantBinding;
  if (binding.version !== 1 || binding.entity !== entity
    || !/^acct_[A-Za-z0-9]+$/.test(binding.accountId)
    || !/^\d{8}$/.test(binding.legalEntityNumber)
    || typeof binding.legalEntityName !== "string"
    || typeof binding.apiKeyFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(binding.apiKeyFingerprint)
    || typeof binding.approvedAt !== "string" || !Number.isFinite(Date.parse(binding.approvedAt))
    || typeof binding.approvedBy !== "string" || !/^[^\r\n]{3,160}$/.test(binding.approvedBy.trim())
    || typeof binding.evidenceReference !== "string" || !/^[A-Za-z0-9._:/-]{3,160}$/.test(binding.evidenceReference.trim())) {
    return { status: "invalid" };
  }
  const configAccountId = env[contract.account]?.trim();
  const expectedNumber = contracts[entity].legalEntityNumber;
  const configuredKey = env[contract.key]?.trim() ?? "";
  if (binding.accountId !== configAccountId || binding.legalEntityNumber !== expectedNumber
    || binding.apiKeyFingerprint !== stripeMerchantApiKeyFingerprint(configuredKey)
    || canonicalLegalName(binding.legalEntityName) !== canonicalLegalName(expectedLegalNames[entity])) {
    return { status: "mismatch", binding };
  }
  try {
    const signatureBytes = Buffer.from(signature, "base64");
    if (!signatureBytes.length || signatureBytes.toString("base64") !== signature
      || !verifySignature(null, Buffer.from(stripeMerchantBindingMessage(binding), "utf8"), publicKey, signatureBytes)) {
      return { status: "invalid" };
    }
  } catch {
    return { status: "invalid" };
  }
  return { status: "verified", binding };
}

export function stripeMerchantContract(entity: StripeMerchantEntity) {
  return contracts[entity];
}

export function stripeApiKeyMatchesMode(secretKey: string, mode: "test" | "live"): boolean {
  const match = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{6,}$/.exec(secretKey);
  return Boolean(match && match[1] === mode);
}

function canonicalLegalName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd)\b/g, " ").replace(/[^a-z]/g, "") || null;
}

export function readStripeMerchantConfig(
  entity: StripeMerchantEntity,
  env: NodeJS.ProcessEnv = process.env,
): StripeMerchantConfig {
  const contract = contracts[entity];
  const secretKey = env[contract.key]?.trim();
  const webhookSecret = env[contract.webhook]?.trim();
  const accountId = env[contract.account]?.trim();
  const modeValue = env[contract.mode]?.trim().toLowerCase();
  if (!secretKey || !webhookSecret || !accountId || !modeValue) {
    throw new Error(`${contract.label} Stripe configuration is incomplete`);
  }
  if (modeValue !== "test" && modeValue !== "live") {
    throw new Error(`${contract.label} Stripe mode must be test or live`);
  }
  // Vercel Preview runs with NODE_ENV=production. Permit test credentials only
  // in an explicitly identified Preview deployment; a production deployment
  // (or any unknown production runtime) remains live-only.
  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && modeValue !== "live") {
    throw new Error(`${contract.label} Stripe production configuration must use live mode`);
  }
  if (!stripeApiKeyMatchesMode(secretKey, modeValue)) {
    throw new Error(`${contract.label} Stripe key does not match its configured mode`);
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || !webhookSecret.startsWith("whsec_")) {
    throw new Error(`${contract.label} Stripe account or webhook configuration is invalid`);
  }
  return { entity, label: contract.label, legalEntityNumber: contract.legalEntityNumber, secretKey, webhookSecret, accountId, mode: modeValue };
}

export async function stripeMerchantRequest<T>(
  entity: StripeMerchantEntity,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const config = readStripeMerchantConfig(entity, env);
  let response: Response;
  try {
    response = await fetcher(`https://api.stripe.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.secretKey}`, ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    // Fetch exceptions can contain request details; surface only a safe class.
    throw new StripeMerchantNetworkError(config.label);
  }
  let raw: unknown;
  try { raw = await response.json(); } catch { raw = undefined; }
  if (!response.ok) {
    const error = raw && typeof raw === "object" && "error" in raw
      ? (raw as { error?: Record<string, unknown> }).error : undefined;
    const permissionValue = error?.missing_permission ?? error?.missing_permissions ?? error?.permission;
    const permissionValues = Array.isArray(permissionValue) ? permissionValue : [permissionValue];
    throw new StripeMerchantApiError(config.label, {
      status: response.status,
      type: safeStripeIdentifier(error?.type),
      code: safeStripeIdentifier(error?.code),
      missingPermission: permissionValues.map(safeStripePermission).find(Boolean),
    });
  }
  const value = raw as T;
  return value;
}

/** Verifies that the credential is bound to its configured legal merchant. */
export async function verifyStripeMerchantAccount(
  entity: StripeMerchantEntity,
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = readStripeMerchantConfig(entity, env);
  // Restricted live keys cannot read Stripe's self-account resource when
  // Stripe omits Accounts: Read from the key-permissions UI. Require an
  // offline operator-signed binding instead of trusting the account ID env
  // setting. Keep the API identity check for test mode.
  if (config.mode === "live") {
    const binding = inspectStripeMerchantBinding(entity, env);
    if (binding.status !== "verified") {
      throw new Error(`${config.label} Stripe account binding is ${binding.status}`);
    }
    return config;
  }
  const account = await stripeMerchantRequest<{ id?: string; company?: { name?: string | null } }>(entity, "/account", {}, fetcher, env);
  if (account.id !== config.accountId || canonicalLegalName(account.company?.name) !== canonicalLegalName(config.label)) {
    throw new Error(`${config.label} Stripe account identity does not match configuration`);
  }
  return config;
}

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

const contracts = {
  madhouse_franchise: {
    label: "Madhouse Franchise Limited",
    legalEntityNumber: "17383077",
    key: "STRIPE_FRANCHISE_SECRET_KEY",
    webhook: "STRIPE_FRANCHISE_WEBHOOK_SECRET",
    account: "STRIPE_FRANCHISE_ACCOUNT_ID",
    mode: "STRIPE_FRANCHISE_MODE",
  },
  madhouse_products_services: {
    label: "Madhouse Products and Services Limited",
    legalEntityNumber: "17383213",
    key: "STRIPE_PRODUCTS_SERVICES_SECRET_KEY",
    webhook: "STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET",
    account: "STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID",
    mode: "STRIPE_PRODUCTS_SERVICES_MODE",
  },
} as const;

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
  const response = await fetcher(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.secretKey}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const value = await response.json() as T;
  // Provider error bodies are intentionally not propagated: diagnostics and
  // logs must never echo credentials or arbitrary provider-controlled text.
  if (!response.ok) throw new Error(`${config.label} Stripe request failed (HTTP ${response.status})`);
  return value;
}

/** Verifies that the credential is bound to its configured legal merchant. */
export async function verifyStripeMerchantAccount(
  entity: StripeMerchantEntity,
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = readStripeMerchantConfig(entity, env);
  const account = await stripeMerchantRequest<{ id?: string; company?: { name?: string | null } }>(entity, "/account", {}, fetcher, env);
  if (account.id !== config.accountId || canonicalLegalName(account.company?.name) !== canonicalLegalName(config.label)) {
    throw new Error(`${config.label} Stripe account identity does not match configuration`);
  }
  return config;
}

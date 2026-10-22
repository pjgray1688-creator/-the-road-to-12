import { readStripeMerchantConfig, stripeMerchantRequest, type StripeMerchantEntity } from "./stripe-merchant";

export type StripeMerchantDiagnostic = {
  entity: StripeMerchantEntity;
  configuration: "ready" | "missing_or_invalid";
  mode: "live" | "not_live" | "unavailable";
  accountIdentity: "confirmed" | "mismatch" | "blocked_or_unavailable" | "not_checked";
  legalEntityIdentity: "confirmed" | "mismatch" | "unavailable" | "not_checked";
  webhookSecret: "configured" | "missing_or_invalid";
  liveCheckoutGate: "enabled" | "disabled";
  checkoutWritePermission: "not_probed";
  requiredPermissions: string[];
};

const requiredPermissions: Record<StripeMerchantEntity, string[]> = {
  madhouse_franchise: [
    "Accounts: Read (self-account identity only; no connected-account access)",
    "Checkout Sessions: Write (create, retrieve and expire checkout sessions)",
    "Charges: Read (signed dispute events are reconciled through charge retrieval)",
    "Invoices: Read (signed recurring billing events are reconciled through invoice retrieval)",
  ],
  madhouse_products_services: [
    "Accounts: Read (self-account identity only; no connected-account access)",
    "Checkout Sessions: Write (create, retrieve and expire class/shop/service sessions)",
    "Prices: Read (validate the server catalogue price before shop checkout)",
    "Charges: Read (signed refund/dispute events are reconciled through charge retrieval)",
    "Payment Intents: Read (resolve metadata for signed refund/dispute events)",
  ],
};

const expectedLegalNames: Record<StripeMerchantEntity, string> = {
  madhouse_franchise: "madhouse franchise",
  madhouse_products_services: "madhouse products and services",
};

function canonicalLegalName(value: string | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd)\b/g, " ").replace(/[^a-z]/g, "") || null;
}

async function inspectEntity(entity: StripeMerchantEntity, expectedMode: "live" | "test", env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<{ diagnostic: StripeMerchantDiagnostic; accountId?: string }> {
  let config;
  try { config = readStripeMerchantConfig(entity, env); }
  catch {
    return { diagnostic: {
      entity, configuration: "missing_or_invalid", mode: "unavailable", accountIdentity: "not_checked", legalEntityIdentity: "not_checked",
      webhookSecret: "missing_or_invalid", liveCheckoutGate: "disabled", checkoutWritePermission: "not_probed",
      requiredPermissions: requiredPermissions[entity],
    } };
  }
  const liveEnabled = entity === "madhouse_franchise"
    ? env.STRIPE_FRANCHISE_LIVE_ENABLED === "true"
    : env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED === "true";
  let accountIdentity: StripeMerchantDiagnostic["accountIdentity"] = "blocked_or_unavailable";
  let legalEntityIdentity: StripeMerchantDiagnostic["legalEntityIdentity"] = "unavailable";
  try {
    // Keep only identifier and legal company name; never serialize account
    // details or any customer/payment objects returned by Stripe.
    const account = await stripeMerchantRequest<{ id?: string; company?: { name?: string | null } }>(entity, "/account", {}, fetcher, env);
    accountIdentity = account.id === config.accountId ? "confirmed" : "mismatch";
    const actualName = canonicalLegalName(account.company?.name ?? undefined);
    const expectedName = canonicalLegalName(expectedLegalNames[entity]);
    legalEntityIdentity = actualName ? actualName === expectedName ? "confirmed" : "mismatch" : "unavailable";
  } catch {
    accountIdentity = "blocked_or_unavailable";
    legalEntityIdentity = "unavailable";
  }
  return { accountId: config.accountId, diagnostic: {
    entity, configuration: "ready", mode: config.mode === "live" && config.mode === expectedMode ? "live" : "not_live",
    accountIdentity, legalEntityIdentity, webhookSecret: config.webhookSecret.startsWith("whsec_") ? "configured" : "missing_or_invalid",
    liveCheckoutGate: liveEnabled ? "enabled" : "disabled", checkoutWritePermission: "not_probed",
    requiredPermissions: requiredPermissions[entity],
  } };
}

/**
 * Safe live readiness probe. It performs only GET /v1/account for each
 * configured entity; it never creates or mutates Stripe resources.
 */
export async function inspectStripeReadiness(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<{
  merchants: StripeMerchantDiagnostic[];
  accountIdsDistinct: "yes" | "no" | "unverified";
  classWebhookSecret: "configured" | "missing_or_invalid";
  checkoutWriteChecks: "not_performed_read_only_only";
}> {
  const [franchise, products] = await Promise.all([
    inspectEntity("madhouse_franchise", "live", env, fetcher),
    inspectEntity("madhouse_products_services", "live", env, fetcher),
  ]);
  const idsKnown = Boolean(franchise.accountId && products.accountId);
  const classWebhookSecret = env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET;
  return {
    merchants: [franchise.diagnostic, products.diagnostic],
    accountIdsDistinct: idsKnown ? franchise.accountId !== products.accountId ? "yes" : "no" : "unverified",
    classWebhookSecret: classWebhookSecret?.startsWith("whsec_") ? "configured" : "missing_or_invalid",
    checkoutWriteChecks: "not_performed_read_only_only",
  };
}

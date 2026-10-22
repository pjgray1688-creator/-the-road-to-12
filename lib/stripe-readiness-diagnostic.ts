import { inspectStripeMerchantBinding, readStripeMerchantConfig, stripeMerchantApiKeyFingerprint, stripeMerchantRequest, StripeMerchantApiError, StripeMerchantNetworkError, type StripeMerchantEntity } from "./stripe-merchant";

export type StripeMerchantDiagnostic = {
  entity: StripeMerchantEntity;
  configuration: "ready" | "missing_or_invalid";
  mode: "live" | "not_live" | "unavailable";
  accountBinding: "verified" | "missing" | "invalid" | "mismatch" | "not_checked";
  apiKeyFingerprint?: string;
  bindingApproval?: { approvedAt: string; approvedBy: string; evidenceReference: string };
  keyAuthentication: "accepted" | "rejected" | "unknown" | "not_tested";
  selfAccountRead: "available" | "permission_denied" | "unavailable" | "not_tested";
  selfAccountReadError: null | { status?: number; type?: string; code?: string; missingPermission?: string; kind: "stripe_api" | "network" | "diagnostic" };
  providerIdentityMatch: "confirmed" | "mismatch" | "unavailable" | "not_tested";
  webhookSecret: "configured" | "missing_or_invalid";
  liveCheckoutGate: "enabled" | "disabled";
  checkoutPermission: "not_tested";
  requiredPermissions: string[];
};

const requiredPermissions: Record<StripeMerchantEntity, string[]> = {
  madhouse_franchise: [
    "Checkout Sessions: Write (create, retrieve and expire checkout sessions)",
    "Charges: Read (signed dispute events are reconciled through charge retrieval)",
    "Invoices: Read (signed recurring billing events are reconciled through invoice retrieval)",
  ],
  madhouse_products_services: [
    "Checkout Sessions: Write (create, retrieve and expire class/shop/service sessions)",
    "Prices: Read (validate the server catalogue price before shop checkout)",
    "Charges: Read (signed refund/dispute events are reconciled through charge retrieval)",
    "Payment Intents: Read (resolve metadata for signed refund/dispute events)",
  ],
};

async function inspectEntity(entity: StripeMerchantEntity, expectedMode: "live" | "test", env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<StripeMerchantDiagnostic> {
  let config;
  try { config = readStripeMerchantConfig(entity, env); }
  catch {
    return {
      entity, configuration: "missing_or_invalid", mode: "unavailable", accountBinding: "not_checked",
      keyAuthentication: "not_tested", selfAccountRead: "not_tested", selfAccountReadError: null,
      providerIdentityMatch: "not_tested", webhookSecret: "missing_or_invalid", liveCheckoutGate: "disabled",
      checkoutPermission: "not_tested", requiredPermissions: requiredPermissions[entity],
    };
  }
  const binding = inspectStripeMerchantBinding(entity, env);
  const liveEnabled = entity === "madhouse_franchise"
    ? env.STRIPE_FRANCHISE_LIVE_ENABLED === "true"
    : env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED === "true";
  let keyAuthentication: StripeMerchantDiagnostic["keyAuthentication"] = "unknown";
  let selfAccountRead: StripeMerchantDiagnostic["selfAccountRead"] = "unavailable";
  let selfAccountReadError: StripeMerchantDiagnostic["selfAccountReadError"] = null;
  let providerIdentityMatch: StripeMerchantDiagnostic["providerIdentityMatch"] = "unavailable";
  try {
    // Read-only probe only. This does not use Connect's /v1/accounts/:id.
    const account = await stripeMerchantRequest<{ id?: string; company?: { name?: string | null } }>(entity, "/account", {}, fetcher, env);
    keyAuthentication = "accepted";
    selfAccountRead = "available";
    const sameId = account.id === config.accountId;
    const sameName = typeof account.company?.name === "string"
      && account.company.name.toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd)\b/g, " ").replace(/[^a-z]/g, "")
        === config.label.toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd)\b/g, " ").replace(/[^a-z]/g, "");
    providerIdentityMatch = sameId && sameName ? "confirmed" : "mismatch";
  } catch (error) {
    if (error instanceof StripeMerchantApiError) {
      selfAccountReadError = { kind: "stripe_api", ...error.safe };
      selfAccountRead = error.safe.status === 403 ? "permission_denied" : "unavailable";
      keyAuthentication = error.safe.status === 401 ? "rejected"
        : error.safe.status === 403 && (error.safe.code === "more_permissions_required" || Boolean(error.safe.missingPermission)) ? "accepted"
          : "unknown";
    } else if (error instanceof StripeMerchantNetworkError) {
      selfAccountReadError = { kind: "network" };
    } else {
      selfAccountReadError = { kind: "diagnostic" };
    }
  }

  return {
    entity, configuration: "ready", mode: config.mode === "live" && config.mode === expectedMode ? "live" : "not_live",
    accountBinding: binding.status,
    apiKeyFingerprint: stripeMerchantApiKeyFingerprint(config.secretKey),
    ...(binding.status === "verified" && binding.binding ? { bindingApproval: {
      approvedAt: binding.binding.approvedAt,
      approvedBy: binding.binding.approvedBy,
      evidenceReference: binding.binding.evidenceReference,
    } } : {}),
    keyAuthentication, selfAccountRead, selfAccountReadError, providerIdentityMatch,
    webhookSecret: config.webhookSecret.startsWith("whsec_") ? "configured" : "missing_or_invalid",
    liveCheckoutGate: liveEnabled ? "enabled" : "disabled", checkoutPermission: "not_tested",
    requiredPermissions: requiredPermissions[entity],
  };
}

/** Read-only readiness probes. It checks auth/self-account permission and never creates Stripe resources. */
export async function inspectStripeReadiness(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<{
  merchants: StripeMerchantDiagnostic[];
  accountIdsDistinct: "yes" | "no" | "unverified";
  classWebhookSecret: "configured" | "missing_or_invalid";
  checkoutPermissionChecks: "not_performed_read_only_only";
}> {
  const [franchise, products] = await Promise.all([
    inspectEntity("madhouse_franchise", "live", env, fetcher),
    inspectEntity("madhouse_products_services", "live", env, fetcher),
  ]);
  const franchiseId = env.STRIPE_FRANCHISE_ACCOUNT_ID?.trim();
  const productsId = env.STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID?.trim();
  const idsKnown = Boolean(franchiseId && productsId);
  const classWebhookSecret = env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET;
  return {
    merchants: [franchise, products],
    accountIdsDistinct: idsKnown ? franchiseId !== productsId ? "yes" : "no" : "unverified",
    classWebhookSecret: classWebhookSecret?.startsWith("whsec_") ? "configured" : "missing_or_invalid",
    checkoutPermissionChecks: "not_performed_read_only_only",
  };
}

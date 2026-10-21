import type { ClubProduct } from "./club";

/** Stable codes are bound to organisation product rows by the forward migration.
 * Checkout never identifies a product from a name, amount, or browser label. */
export const PAYPAL_PAY_IN_3_PRODUCT_CODES = {
  transformationBronze: "madhouse.transformation.bronze.v1",
  transformationSilver: "madhouse.transformation.silver.v1",
  transformationGold: "madhouse.transformation.gold.v1",
  yearlyMembership: "madhouse.membership.yearly.v1",
  goldenTicketLifetime: "madhouse.membership.golden-ticket-lifetime.v1",
} as const;

export type PayPalPayIn3ProductCode = typeof PAYPAL_PAY_IN_3_PRODUCT_CODES[keyof typeof PAYPAL_PAY_IN_3_PRODUCT_CODES];
export type PayPalMerchantReadiness = {
  legalEntityNumber: string;
  merchantAccountId: string | null;
  paypalApproved: boolean;
  accountantApproved: boolean;
  enabled: boolean;
};
export type PayPalPayIn3RuntimeReadiness = {
  featureEnabled: boolean;
  clientIdConfigured: boolean;
  secretConfigured: boolean;
  merchant: PayPalMerchantReadiness | null;
  buyerEligible: boolean;
};

export type PayPalPayIn3Eligibility = { eligible: true; productCode: PayPalPayIn3ProductCode; receivingEntity: "Madhouse Franchise Limited" } | { eligible: false; reason: string };

const productContract: Record<PayPalPayIn3ProductCode, { kind: ClubProduct["kind"]; billing: ClubProduct["billing"]; durationDays?: number; lifetime: boolean; sellable: boolean; entitlements: string[] }> = {
  [PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze]: { kind: "transformation", billing: "one_off", durationDays: 70, lifetime: false, sellable: true, entitlements: ["gym_access", "enhanced_training", "nutrition", "trainer_managed", "pt_session_credit", "included_class_credit"] },
  [PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationSilver]: { kind: "transformation", billing: "one_off", durationDays: 70, lifetime: false, sellable: true, entitlements: ["gym_access", "enhanced_training", "nutrition", "trainer_managed", "pt_session_credit", "included_class_credit"] },
  [PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationGold]: { kind: "transformation", billing: "one_off", durationDays: 70, lifetime: false, sellable: true, entitlements: ["gym_access", "enhanced_training", "nutrition", "trainer_managed", "pt_session_credit", "included_class_credit"] },
  [PAYPAL_PAY_IN_3_PRODUCT_CODES.yearlyMembership]: { kind: "membership", billing: "one_off", durationDays: 365, lifetime: false, sellable: true, entitlements: ["gym_access"] },
  [PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime]: { kind: "membership", billing: "one_off", lifetime: true, sellable: false, entitlements: ["gym_access", "discount"] },
};

export function paypalPayIn3FeatureEnabled(value = process.env.R12_PAYPAL_PAY_IN_3_ENABLED): boolean {
  return value === "true";
}

export function isPayPalPayIn3ProductCode(value: string): value is PayPalPayIn3ProductCode {
  return Object.values(PAYPAL_PAY_IN_3_PRODUCT_CODES).some(code => code === value);
}

export function evaluatePayPalPayIn3Eligibility(input: {
  product: ClubProduct;
  productCode: string | null;
  readiness: PayPalPayIn3RuntimeReadiness;
  goldenTicketSale?: { individuallyAuthorised: boolean; customerInOrganisation: boolean };
}): PayPalPayIn3Eligibility {
  const { product, productCode, readiness } = input;
  if (!productCode || !isPayPalPayIn3ProductCode(productCode)) return { eligible: false, reason: "This product is not on the PayPal Pay in 3 allowlist." };
  const contract = productContract[productCode];
  if (product.kind !== contract.kind || product.billing !== contract.billing || (product.isLifetime === true) !== contract.lifetime || product.sellable !== contract.sellable || product.durationDays !== contract.durationDays || product.archivedAt) {
    return { eligible: false, reason: "The product does not match its approved checkout and entitlement definition." };
  }
  const actualEntitlements = product.entitlements ?? [];
  const expectedKeys = [...contract.entitlements].sort();
  const actualKeys = actualEntitlements.map(item => item.entitlementKey).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return { eligible: false, reason: "The product’s approved R12 entitlements are not configured." };
  if (actualEntitlements.some(item => item.entitlementKey === "gym_access" && item.scope !== "future_locations")) return { eligible: false, reason: "The product’s approved R12 access scope is not configured." };
  if (productCode.startsWith("madhouse.transformation.")) {
    const expectedPtCredits = productCode.endsWith("bronze.v1") ? 1 : productCode.endsWith("silver.v1") ? 2 : 3;
    const credit = actualEntitlements.find(item => item.entitlementKey === "pt_session_credit");
    if (credit?.scope !== "organisation" || credit.allowance?.quantity !== expectedPtCredits || credit.allowance.period !== "week") return { eligible: false, reason: "The approved transformation package entitlements do not match." };
    const includedClass = actualEntitlements.find(item => item.entitlementKey === "included_class_credit");
    if (includedClass?.scope !== "organisation" || includedClass.allowance?.quantity !== 1 || includedClass.allowance.period !== "week") return { eligible: false, reason: "The approved transformation package entitlements do not match." };
    if (["enhanced_training", "nutrition", "trainer_managed"].some(key => actualEntitlements.find(item => item.entitlementKey === key)?.scope !== "organisation")) return { eligible: false, reason: "The approved transformation package entitlements do not match." };
  }
  if (productCode === PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime) {
    const discount = actualEntitlements.find(item => item.entitlementKey === "discount");
    if (discount?.scope !== "organisation" || discount.discount?.percent !== 20 || discount.discount.period !== "month" || discount.discount.maxUses !== 1) return { eligible: false, reason: "The lifetime product entitlements do not match." };
  }
  if (product.priceMinor <= 0 || !Number.isSafeInteger(product.priceMinor) || product.currency !== "GBP") return { eligible: false, reason: "The product price is not available for this checkout." };
  if (productCode === PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime && (!input.goldenTicketSale?.individuallyAuthorised || !input.goldenTicketSale.customerInOrganisation)) {
    return { eligible: false, reason: "Golden Ticket sales require an individually authorised Madhouse staff sale for an existing Club customer." };
  }
  const merchant = readiness.merchant;
  if (!readiness.featureEnabled || !readiness.clientIdConfigured || !readiness.secretConfigured || !merchant?.enabled || !merchant.paypalApproved || !merchant.accountantApproved || !merchant.merchantAccountId || merchant.legalEntityNumber !== "17383077") {
    return { eligible: false, reason: "PayPal Pay in 3 checkout is not enabled and approved for the Madhouse membership merchant." };
  }
  if (!readiness.buyerEligible) return { eligible: false, reason: "PayPal has not confirmed Pay in 3 eligibility for this buyer and transaction." };
  return { eligible: true, productCode, receivingEntity: "Madhouse Franchise Limited" };
}

/** Readiness is a server-only configuration check. It never calls PayPal. */
export function paypalPayIn3EnvironmentReadiness(env: NodeJS.ProcessEnv = process.env) {
  return {
    featureEnabled: paypalPayIn3FeatureEnabled(env.R12_PAYPAL_PAY_IN_3_ENABLED),
    clientIdConfigured: Boolean(env.PAYPAL_CLIENT_ID?.trim()),
    secretConfigured: Boolean(env.PAYPAL_CLIENT_SECRET?.trim()),
  };
}

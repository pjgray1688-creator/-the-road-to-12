"use server";

import { serverSupabase } from "@/lib/supabase-server";
import { adminSupabase } from "@/lib/supabase-admin";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { mapProduct } from "@/lib/supabase-club-repository";
import { evaluatePayPalPayIn3CheckoutReadiness, paypalPayIn3EnvironmentReadiness, PAYPAL_PAY_IN_3_PRODUCT_CODES } from "@/lib/paypal-pay-in-3";
import { createPayPalOrder, isPayPalPayIn3Enabled, readPayPalProviderConfig } from "@/lib/paypal-provider";
import { siteUrl } from "@/lib/site-url";
import { capturePayPalOrderForBuyer } from "@/lib/paypal-pay-in-3-reconciliation";

/** Eligibility-only boundary. It deliberately cannot create a PayPal order,
 * capture money, write an intent, or grant a Club entitlement. */
export async function checkPayPalCheckoutReadinessAction(input: {
  organisationId: string;
  productId: string;
  goldenTicketSale?: { customerId: string; reason: string; explicitlyAuthorised: boolean };
}) {
  try {
    const session = await serverSupabase();
    const { data: { user } } = await session.auth.getUser();
    if (!user?.email_confirmed_at) return { checkoutReady: false as const, error: "Sign in with a verified R12 account to continue." };
    const admin = adminSupabase();
    const [{ data: organisation }, { data: productRow }, { data: codeRow }, { data: settings }] = await Promise.all([
      admin.from("club_organisations").select("id,slug").eq("id", input.organisationId).maybeSingle(),
      admin.from("club_products").select("*").eq("id", input.productId).eq("organisation_id", input.organisationId).maybeSingle(),
      admin.from("club_paypal_pay_in_3_product_codes").select("canonical_product_code").eq("organisation_id", input.organisationId).eq("product_id", input.productId).maybeSingle(),
      admin.from("club_paypal_pay_in_3_settings").select("legal_entity_number,merchant_account_id,paypal_approved,accountant_approved,enabled").eq("organisation_id", input.organisationId).maybeSingle(),
    ]);
    if (!organisation || organisation.slug !== "madhouse-gym" || !productRow) return { checkoutReady: false as const, error: "This checkout product is not available." };

    const productCode = typeof codeRow?.canonical_product_code === "string" ? codeRow.canonical_product_code : null;
    let goldenTicketSale: { individuallyAuthorised: boolean; customerInOrganisation: boolean } | undefined;
    if (productCode === PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime) {
      if (!input.goldenTicketSale?.explicitlyAuthorised || input.goldenTicketSale.reason.trim().length < 8 || !input.goldenTicketSale.customerId) {
        return { checkoutReady: false as const, error: "Golden Ticket requires a named, individually authorised staff sale." };
      }
      const staff = await resolveClubOperationalContext(session, user.id, input.organisationId);
      const authorised = Boolean(staff && await staff.repository.hasCapability(input.organisationId, user.id, "memberships.assign"));
      if (!authorised) return { checkoutReady: false as const, error: "You don’t have permission to authorise a Golden Ticket sale." };
      const { data: customer } = await admin.from("club_customers").select("id").eq("id", input.goldenTicketSale.customerId).eq("organisation_id", input.organisationId).maybeSingle();
      goldenTicketSale = { individuallyAuthorised: authorised, customerInOrganisation: Boolean(customer) };
    }

    const { data: entitlementRows } = await admin.from("club_product_entitlements").select("*").eq("organisation_id", input.organisationId).eq("product_id", input.productId);
    const product = mapProduct(productRow, entitlementRows ?? []);
    const readiness = paypalPayIn3EnvironmentReadiness();
    const result = evaluatePayPalPayIn3CheckoutReadiness({
      product,
      productCode,
      readiness: {
        ...readiness,
        merchant: settings ? {
          legalEntityNumber: String(settings.legal_entity_number),
          merchantAccountId: typeof settings.merchant_account_id === "string" ? settings.merchant_account_id : null,
          paypalApproved: settings.paypal_approved === true,
          accountantApproved: settings.accountant_approved === true,
          enabled: settings.enabled === true,
        } : null,
      },
      goldenTicketSale,
    });
    return result.checkoutReady
      ? { checkoutReady: true as const, receivingEntity: result.receivingEntity, financingDecision: result.financingDecision }
      : { checkoutReady: false as const, error: result.reason };
  } catch {
    return { checkoutReady: false as const, error: "PayPal checkout is not available." };
  }
}

export async function startPayPalPayIn3CheckoutAction(input: { requestId: string; idempotencyKey: string }) {
  try {
    if (!isPayPalPayIn3Enabled()) return { ok: false as const, error: "PayPal checkout is currently unavailable." };
    readPayPalProviderConfig();
    const session = await serverSupabase();
    const { data: { user } } = await session.auth.getUser();
    if (!user?.email_confirmed_at) return { ok: false as const, error: "Sign in with a verified R12 account to continue." };
    const { data: prepared, error } = await session.rpc("club_prepare_paypal_pay_in_3_order", {
      p_join_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error || !prepared || typeof prepared !== "object") return { ok: false as const, error: "PayPal checkout is not ready for this membership." };
    const order = prepared as Record<string, unknown>;
    const orderId = String(order.id ?? "");
    const amountMinor = Number(order.amount_minor);
    const merchantId = String(order.merchant_account_id ?? "");
    const providerOrderId = typeof order.provider_order_id === "string" ? order.provider_order_id : null;
    if (!orderId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !merchantId) {
      return { ok: false as const, error: "PayPal checkout could not be prepared." };
    }

    let providerOrder: Awaited<ReturnType<typeof createPayPalOrder>>;
    if (providerOrderId && typeof order.provider_approval_url === "string") {
      const { retrievePayPalOrder } = await import("@/lib/paypal-provider");
      providerOrder = await retrievePayPalOrder(providerOrderId);
    } else {
      providerOrder = await createPayPalOrder({
        orderId,
        merchantId,
        amountMinor,
        currency: "GBP",
        description: String(order.canonical_product_code).replaceAll(".", " "),
        returnUrl: `${siteUrl()}/api/club/join/paypal/complete`,
        cancelUrl: `${siteUrl()}/api/club/join/paypal/cancel`,
      });
    }
    if (providerOrder.status === "APPROVED" || providerOrder.status === "COMPLETED") {
      await capturePayPalOrderForBuyer(providerOrder.id, user.id);
      return { ok: true as const, url: `${siteUrl()}/join/madhouse?billing=paypal-confirmed`, orderId: providerOrder.id };
    }
    const approvalUrl = providerOrder.links?.find(link => link.rel === "approve")?.href ?? providerOrder.links?.find(link => link.rel === "payer-action")?.href;
    if (!approvalUrl || !/^https:\/\/(www\.paypal\.com|www\.sandbox\.paypal\.com)\//.test(approvalUrl)) {
      return { ok: false as const, error: "PayPal did not return a safe approval link." };
    }
    const admin = adminSupabase();
    const { error: storedError } = await admin.rpc("club_store_paypal_pay_in_3_order", {
      p_order_id: orderId,
      p_provider_order_id: providerOrder.id,
      p_approval_url: approvalUrl,
    });
    if (storedError) return { ok: false as const, error: "PayPal checkout could not be linked safely." };
    return { ok: true as const, url: approvalUrl, orderId: providerOrder.id };
  } catch {
    return { ok: false as const, error: "PayPal checkout could not be started." };
  }
}

/** Called by the authenticated return route. The browser return is only a
 * trigger; provider capture state is retrieved and verified server-side. */
export async function completePayPalPayIn3ReturnAction(providerOrderId: string) {
  try {
    const session = await serverSupabase();
    const { data: { user } } = await session.auth.getUser();
    if (!user?.email_confirmed_at) return { ok: false as const };
    await capturePayPalOrderForBuyer(providerOrderId, user.id);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

"use server";

import { serverSupabase } from "@/lib/supabase-server";
import { adminSupabase } from "@/lib/supabase-admin";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { mapProduct } from "@/lib/supabase-club-repository";
import { evaluatePayPalPayIn3Eligibility, paypalPayIn3EnvironmentReadiness, PAYPAL_PAY_IN_3_PRODUCT_CODES } from "@/lib/paypal-pay-in-3";

/** Eligibility-only boundary. It deliberately cannot create a PayPal order,
 * capture money, write an intent, or grant a Club entitlement. */
export async function checkPayPalPayIn3EligibilityAction(input: {
  organisationId: string;
  productId: string;
  goldenTicketSale?: { customerId: string; reason: string; explicitlyAuthorised: boolean };
}) {
  try {
    const session = await serverSupabase();
    const { data: { user } } = await session.auth.getUser();
    if (!user?.email_confirmed_at) return { eligible: false as const, error: "Sign in with a verified R12 account to continue." };
    const admin = adminSupabase();
    const [{ data: organisation }, { data: productRow }, { data: codeRow }, { data: settings }] = await Promise.all([
      admin.from("club_organisations").select("id,slug").eq("id", input.organisationId).maybeSingle(),
      admin.from("club_products").select("*").eq("id", input.productId).eq("organisation_id", input.organisationId).maybeSingle(),
      admin.from("club_paypal_pay_in_3_product_codes").select("canonical_product_code").eq("organisation_id", input.organisationId).eq("product_id", input.productId).maybeSingle(),
      admin.from("club_paypal_pay_in_3_settings").select("legal_entity_number,merchant_account_id,paypal_approved,accountant_approved,enabled").eq("organisation_id", input.organisationId).maybeSingle(),
    ]);
    if (!organisation || organisation.slug !== "madhouse-gym" || !productRow) return { eligible: false as const, error: "This checkout product is not available." };

    const productCode = typeof codeRow?.canonical_product_code === "string" ? codeRow.canonical_product_code : null;
    let goldenTicketSale: { individuallyAuthorised: boolean; customerInOrganisation: boolean } | undefined;
    if (productCode === PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime) {
      if (!input.goldenTicketSale?.explicitlyAuthorised || input.goldenTicketSale.reason.trim().length < 8 || !input.goldenTicketSale.customerId) {
        return { eligible: false as const, error: "Golden Ticket requires a named, individually authorised staff sale." };
      }
      const staff = await resolveClubOperationalContext(session, user.id, input.organisationId);
      const authorised = Boolean(staff && await staff.repository.hasCapability(input.organisationId, user.id, "memberships.assign"));
      if (!authorised) return { eligible: false as const, error: "You don’t have permission to authorise a Golden Ticket sale." };
      const { data: customer } = await admin.from("club_customers").select("id").eq("id", input.goldenTicketSale.customerId).eq("organisation_id", input.organisationId).maybeSingle();
      goldenTicketSale = { individuallyAuthorised: authorised, customerInOrganisation: Boolean(customer) };
    }

    const { data: entitlementRows } = await admin.from("club_product_entitlements").select("*").eq("organisation_id", input.organisationId).eq("product_id", input.productId);
    const product = mapProduct(productRow, entitlementRows ?? []);
    const readiness = paypalPayIn3EnvironmentReadiness();
    const result = evaluatePayPalPayIn3Eligibility({
      product,
      productCode,
      readiness: {
        ...readiness,
        buyerEligible: false, // PayPal buyer/transaction eligibility is not integrated yet.
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
    return result.eligible ? { eligible: true as const, receivingEntity: result.receivingEntity } : { eligible: false as const, error: result.reason };
  } catch {
    return { eligible: false as const, error: "PayPal Pay in 3 checkout is not available." };
  }
}

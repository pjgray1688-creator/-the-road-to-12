import { adminSupabase } from "@/lib/supabase-admin";
import { isPayPalPayIn3Enabled, readPayPalProviderConfig } from "@/lib/paypal-provider";

/** Product IDs safe to show with generic PayPal checkout wording. PayPal makes
 * the buyer's Pay in 3 decision in its own checkout and may decline to offer it. */
export async function listPayPalCheckoutReadyProductIds(organisationId: string, productIds: string[]) {
  if (!productIds.length || !isPayPalPayIn3Enabled()) return new Set<string>();
  try {
    readPayPalProviderConfig();
    const admin = adminSupabase();
    const [{ data: settings }, { data: codes }] = await Promise.all([
      admin.from("club_paypal_pay_in_3_settings")
        .select("legal_entity_number,merchant_account_id,paypal_approved,accountant_approved,enabled")
        .eq("organisation_id", organisationId).maybeSingle(),
      admin.from("club_paypal_pay_in_3_product_codes")
        .select("product_id,canonical_product_code")
        .eq("organisation_id", organisationId).in("product_id", productIds),
    ]);
    if (!settings || settings.legal_entity_number !== "17383077" || !settings.merchant_account_id
      || settings.paypal_approved !== true || settings.accountant_approved !== true || settings.enabled !== true) return new Set<string>();
    const allowedCodes = new Set([
      "madhouse.transformation.bronze.v1", "madhouse.transformation.silver.v1",
      "madhouse.transformation.gold.v1", "madhouse.membership.yearly.v1",
    ]);
    return new Set((codes ?? [])
      .filter(row => allowedCodes.has(row.canonical_product_code))
      .map(row => row.product_id));
  } catch {
    return new Set<string>();
  }
}

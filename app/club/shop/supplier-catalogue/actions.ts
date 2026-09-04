"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

async function authorised(org: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return; const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "supplier.catalogue_manage")) || !(await context.repository.hasCapability(org, user.id, "commerce.pricing_manage"))) return;
  return { client };
}
export async function publishSupplierOfferAction(input: { organisationId: string; offerId: string; productId: string; retailPriceMinor: number }) {
  const value = await authorised(input.organisationId); if (!value) return { ok: false, error: "Catalogue publication access required." };
  const { data, error } = await value.client.rpc("club_publish_supplier_offer", { p_organisation_id: input.organisationId, p_offer_id: input.offerId, p_club_product_id: input.productId, p_retail_price_minor: input.retailPriceMinor });
  if (error) return { ok: false, error: "Review the product, price and supplier offer before publishing." };
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/club/shop"); return { ok: true, offer: data };
}
export async function createAndPublishSupplierProductAction(input: { organisationId: string; offerId: string; name: string; brand?: string; category?: string; barcode?: string; retailPriceMinor: number }) {
  const value = await authorised(input.organisationId); if (!value) return { ok: false, error: "Catalogue publication access required." };
  const { data, error } = await value.client.rpc("club_create_and_publish_supplier_product", { p_organisation_id: input.organisationId, p_offer_id: input.offerId, p_name: input.name, p_brand: input.brand ?? null, p_category: input.category ?? null, p_barcode: input.barcode ?? null, p_retail_price_minor: input.retailPriceMinor });
  if (error) return { ok: false, error: "The canonical product could not be created." };
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/club/shop"); return { ok: true, offer: data };
}

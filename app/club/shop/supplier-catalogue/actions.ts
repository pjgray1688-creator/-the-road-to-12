"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

async function authorised(org: string, pricing = true) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return; const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "supplier.catalogue_manage")) || pricing && !(await context.repository.hasCapability(org, user.id, "commerce.pricing_manage"))) return;
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

export async function setSupplierVariantRetailPriceAction(input: { organisationId: string; variantId: string; retailPriceMinor: number; active?: boolean }) {
  const value = await authorised(input.organisationId);
  if (!value || !input.variantId || !Number.isInteger(input.retailPriceMinor) || input.retailPriceMinor < 0) return { ok: false, error: "Enter a valid non-negative GBP price." };
  const { error } = await value.client.rpc("club_set_supplier_variant_retail_price", { p_organisation_id: input.organisationId, p_supplier_product_id: input.variantId, p_retail_price_minor: input.retailPriceMinor, p_active: input.active ?? true });
  if (error) return { ok: false, error: "Retail price could not be saved." };
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/member-hub/shop"); return { ok: true };
}

export async function setParentRetailPriceAction(input: { organisationId: string; variantIds: string[]; retailPriceMinor: number }) {
  const value = await authorised(input.organisationId);
  if (!value || !input.variantIds.length || input.variantIds.some(id => !id) || !Number.isInteger(input.retailPriceMinor) || input.retailPriceMinor < 0) return { ok: false, error: "Enter a valid price and variants." };
  for (const variantId of input.variantIds) {
    const { error } = await value.client.rpc("club_set_supplier_variant_retail_price", { p_organisation_id: input.organisationId, p_supplier_product_id: variantId, p_retail_price_minor: input.retailPriceMinor, p_active: true });
    if (error) return { ok: false, error: "One or more variant prices could not be saved." };
  }
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/member-hub/shop"); return { ok: true, updated: input.variantIds.length };
}
export async function commitRetailPriceCsvAction(input: { organisationId: string; rows: Array<{ variantId?: string; retailPriceMinor?: number }> }) {
  const value = await authorised(input.organisationId); if (!value) return { ok: false, error: "Pricing access required." };
  let updated = 0; for (const row of input.rows) { if (!row.variantId || row.retailPriceMinor === undefined) continue; if (!Number.isInteger(row.retailPriceMinor) || row.retailPriceMinor < 0) return { ok: false, error: "Invalid retail price." }; const { error } = await value.client.rpc("club_set_supplier_variant_retail_price", { p_organisation_id: input.organisationId, p_supplier_product_id: row.variantId, p_retail_price_minor: row.retailPriceMinor, p_active: true }); if (error) return { ok: false, error: "Pricing import could not be applied." }; updated++; }
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/member-hub/shop"); return { ok: true, updated };
}

export async function commitCatalogueEnrichmentAction(input: { organisationId: string; rows: Array<Record<string, unknown>> }) {
  const value = await authorised(input.organisationId, false);
  if (!value || !Array.isArray(input.rows)) return { ok: false, error: "Enrichment access required." };
  const payload = input.rows.filter(row => typeof row.variantId === "string" && row.variantId).map(row => ({ organisation_id: input.organisationId, supplier_product_id: row.variantId, description: row.description ?? null, nutrition: { ...(row.nutrition && typeof row.nutrition === "object" ? row.nutrition as Record<string, unknown> : {}), ...(row.servingSize ? { servingSize: row.servingSize } : {}) }, ingredients: row.ingredients ?? null, allergens: row.allergens ?? null, parent_image_url: row.parentImageUrl ?? null, variant_image_url: row.variantImageUrl ?? null, source_url: row.sourceUrl ?? null, source_type: row.sourceType ?? null, verified_at: row.verifiedAt ?? null }));
  if (!payload.length) return { ok: false, error: "No matched enrichment variants to save." };
  const { error } = await value.client.from("club_supplier_variant_enrichment").upsert(payload, { onConflict: "organisation_id,supplier_product_id" });
  if (error) return { ok: false, error: "Enrichment could not be saved." };
  revalidatePath("/club/shop/supplier-catalogue"); revalidatePath("/member-hub/shop"); return { ok: true, updated: payload.length };
}
export async function importGsnCatalogueAction(input:{organisationId:string;rows:Array<{name:string;brand?:string;category?:string;description?:string;retailPriceMinor?:number}>}){const value=await authorised(input.organisationId,false);if(!value||!input.rows.length)return{ok:false,error:"GSN import access required."};let created=0;for(const row of input.rows){const existing=(await value.client.from("club_commerce_products").select("id").eq("organisation_id",input.organisationId).eq("name",row.name).maybeSingle()).data;if(existing)continue;const product=await value.client.from("club_commerce_products").insert({organisation_id:input.organisationId,name:row.name,brand:row.brand??"GSN",category:row.category??"",description:row.description??null,active:true,stock_tracked:true,sell_price_minor:row.retailPriceMinor??0,currency:"GBP"}).select("id").single();if(product.error)return{ok:false,error:"GSN import failed."};created++;}revalidatePath("/club/shop");revalidatePath("/member-hub/shop");return{ok:true,created};}

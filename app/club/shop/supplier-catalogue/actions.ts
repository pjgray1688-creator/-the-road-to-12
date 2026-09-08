"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { gsnCommerceProductInsert } from "@/lib/gsn-catalogue";

async function authorised(org: string, pricing = true) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return; const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "supplier.catalogue_manage")) || pricing && !(await context.repository.hasCapability(org, user.id, "commerce.pricing_manage"))) return;
  return { client, context };
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
export async function importGsnCatalogueAction(input: { organisationId: string; rows: Array<{ name: string; brand?: string; range?: string; category?: string; description?: string; retailPriceMinor?: number; sourceUrl?: string; parentImageReference?: string; variantImageReference?: string; nutrition?: Record<string, unknown>; ingredients?: string; allergens?: string }> }) {
  const value = await authorised(input.organisationId, false);
  if (!value || !input.rows.length) return { ok: false, error: "GSN import access required." };
  let created = 0; let updated = 0; let unchanged = 0;
  for (const row of input.rows) {
    const mapped = gsnCommerceProductInsert({ brand: row.brand ?? "GSN", range: row.range ?? "", name: row.name, category: row.category, description: row.description, retailPriceMinor: row.retailPriceMinor, sourceUrl: row.sourceUrl, parentImageReference: row.parentImageReference, variantImageReference: row.variantImageReference, nutrition: row.nutrition, ingredients: row.ingredients, allergens: row.allergens });
    const existingResult = await value.client.from("club_commerce_products").select("id,name,brand,description,category,active,stock_tracked,sell_price_minor,currency,media,sku,barcode,cost_price_minor,tax_code").eq("organisation_id", input.organisationId).eq("name", mapped.name).eq("category", mapped.category).maybeSingle();
    if (existingResult.error) { console.error("[gsn-import] lookup failed", { product: row.name, code: existingResult.error.code, message: existingResult.error.message }); return { ok: false, error: "Import failed: catalogue database schema is not ready." }; }
    const existing = existingResult.data as Record<string, unknown> | null;
    const currentMedia = existing?.media && typeof existing.media === "object" && !Array.isArray(existing.media) ? existing.media as Record<string, unknown> : {};
    const mergedMedia = { ...currentMedia, ...mapped.media, ...(mapped.media.enrichment && typeof currentMedia.enrichment === "object" ? { enrichment: { ...(currentMedia.enrichment as Record<string, unknown>), ...(mapped.media.enrichment as Record<string, unknown>) } } : {}) };
    const sellPriceMinor = row.retailPriceMinor ?? 400;
    const changed = !existing || Number(existing.sell_price_minor) !== sellPriceMinor || (row.sourceUrl && currentMedia.sourceUrl !== row.sourceUrl) || (row.parentImageReference && currentMedia.parentImageReference !== row.parentImageReference) || (row.variantImageReference && currentMedia.variantImageReference !== row.variantImageReference) || (row.description && existing.description !== row.description) || (row.ingredients && (currentMedia.enrichment as Record<string, unknown> | undefined)?.ingredients !== row.ingredients) || (row.allergens && (currentMedia.enrichment as Record<string, unknown> | undefined)?.allergens !== row.allergens);
    if (!changed) { unchanged++; continue; }
    const product = await value.client.rpc("club_save_commerce_product", { p_id: existing?.id ?? null, p_organisation_id: input.organisationId, p_sku: existing?.sku ?? null, p_barcode: existing?.barcode ?? null, p_name: String(existing?.name ?? mapped.name), p_brand: String(existing?.brand ?? mapped.brand), p_description: row.description ?? existing?.description ?? null, p_category: String(existing?.category ?? mapped.category), p_active: existing?.active !== false, p_stock_tracked: existing?.stock_tracked !== false, p_sell_price_minor: sellPriceMinor, p_cost_price_minor: existing?.cost_price_minor ?? null, p_currency: String(existing?.currency ?? mapped.currency), p_tax_code: existing?.tax_code ?? null, p_supplier_reference: null, p_media: mergedMedia });
    if (product.error) { console.error("[gsn-import] canonical product save failed", { product: row.name, code: product.error.code, message: product.error.message }); return { ok: false, error: product.error.code === "42703" || product.error.code === "42P01" ? "Import failed: catalogue database schema is not ready." : product.error.code === "42501" ? "Import failed: catalogue write permission is not available." : `Import failed while saving “${row.name}”: invalid catalogue data.` }; }
    if (existing) updated++; else created++;
  }
  revalidatePath("/club/shop"); revalidatePath("/member-hub/shop"); return { ok: true, created, updated, unchanged };
}

export async function loadGsnDemoStockAction(input: { organisationId: string; locationId: string; productIds: string[]; targetQuantity?: number }) {
  const value = await authorised(input.organisationId, false);
  const target = input.targetQuantity ?? 10;
  if (!value || !(await value.context.repository.hasCapability(input.organisationId, (await value.client.auth.getUser()).data.user!.id, "inventory.adjust")) || !input.locationId || !input.productIds.length || !Number.isInteger(target) || target < 0) return { ok: false, error: "Demo stock access required." };
  const balances = await value.context.repository.listStockBalances(input.organisationId, input.locationId);
  const byProduct = new Map(balances.map(item => [item.productId, item.onHand ?? 0]));
  let updated = 0;
  for (const productId of [...new Set(input.productIds)]) {
    const delta = target - (byProduct.get(productId) ?? 0);
    if (delta === 0) continue;
    const { error } = await value.client.rpc("club_adjust_inventory", { p_organisation_id: input.organisationId, p_location_id: input.locationId, p_product_id: productId, p_movement_type: "stocktake_adjustment", p_quantity_delta: delta, p_reason: "GSN demo opening stock (temporary)", p_idempotency_key: `gsn-demo-stock:${input.organisationId}:${input.locationId}:${productId}:${target}` });
    if (error) return { ok: false, error: "Demo stock could not be loaded." };
    updated++;
  }
  revalidatePath("/club/shop"); revalidatePath("/member-hub/shop"); return { ok: true, updated, targetQuantity: target };
}

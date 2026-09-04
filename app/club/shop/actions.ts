"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { parseMinorUnits } from "@/lib/club-money";
import { normalizeBarcode, OpenFoodFactsBarcodeProvider } from "@/lib/club-barcode";

type Result = { ok: true; status: string; orderId: string } | { ok: false; error: string };
async function context(organisationId: string) { const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) return undefined; const resolved = await resolveClubOrganisationContext(client, user.id, organisationId); return resolved ? { ...resolved, userId: user.id } : undefined; }
export async function purchaseAction(input: { organisationId: string; productId: string; locationId?: string; quantity: number; payment: "balance" | "cash_box" }): Promise<Result> {
  try { const value = await context(input.organisationId); if (!value || !Number.isInteger(input.quantity) || input.quantity < 1 || input.payment === "cash_box" && !input.locationId) return { ok: false, error: input.payment === "cash_box" ? "Choose a location for cash-box payment." : "This purchase isn’t available." }; const order = await value.repository.createCommerceOrder({ organisationId: value.organisation.id, locationId: input.locationId, userId: value.userId, channel: "member_app", currency: "GBP", items: [{ productId: input.productId, quantity: input.quantity }], idempotencyKey: crypto.randomUUID() }); if (input.payment === "balance") await value.repository.spendBalance(order.id, order.totalMinor, crypto.randomUUID()); else await value.repository.declareCash({ organisationId: value.organisation.id, locationId: input.locationId, purpose: "commerce_order", userId: value.userId, orderId: order.id, amountMinor: order.totalMinor, currency: order.currency, idempotencyKey: crypto.randomUUID() }); revalidatePath("/club/shop"); return { ok: true, status: input.payment === "balance" ? "paid" : "awaiting_cash_verification", orderId: order.id }; } catch (error) { console.error("[club-shop] purchase failed", { operation: error instanceof Error && "operation" in error ? error.operation : "purchase" }); return { ok: false, error: "Purchase couldn’t be completed." }; }
}

export async function staffCashSaleAction(input: { organisationId: string; productId?: string; items?: Array<{ productId: string; quantity: number }>; locationId: string; customerId?: string }): Promise<Result> {
  try { const value = await context(input.organisationId); const items = input.items ?? (input.productId ? [{ productId: input.productId, quantity: 1 }] : []); if (!value || !["gym_staff", "gym_admin", "owner"].includes(value.member.role) || !(await value.repository.hasCapability(value.organisation.id, value.userId, "payments.record_cash")) || !input.locationId || !items.length || items.some(item => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1)) return { ok: false, error: "Check the basket and your cash permissions." }; if (input.customerId && !(await value.repository.listCustomers(input.organisationId)).some(customer => customer.id === input.customerId)) return { ok: false, error: "That customer is not available." }; const order = await value.repository.createCommerceOrder({ organisationId: value.organisation.id, locationId: input.locationId, customerId: input.customerId, channel: "staff_checkout", currency: "GBP", items, idempotencyKey: crypto.randomUUID() }); await value.repository.recordCashPayment(order.id, order.totalMinor, crypto.randomUUID()); await value.repository.appendAuditEvent({ organisationId: value.organisation.id, action: "payment.cash_recorded", targetType: "order", targetId: order.id }); revalidatePath("/club/shop"); return { ok: true, status: "paid", orderId: order.id }; } catch { return { ok: false, error: "Cash sale couldn’t be completed." }; }
}

export async function reconcileCashAction(input: { organisationId: string; declarationId: string; status: "confirmed" | "rejected" | "discrepancy"; notes?: string; discrepancyMinor?: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  try { const value = await context(input.organisationId); if (!value || !["gym_staff", "gym_admin", "owner"].includes(value.member.role) || !(await value.repository.hasCapability(value.organisation.id, value.userId, "cash.reconcile"))) return { ok: false, error: "You don’t have permission to reconcile cash." }; const declaration = await value.repository.reconcileCash(input.declarationId, input.status, input.notes, input.discrepancyMinor); await value.repository.appendAuditEvent({ organisationId: value.organisation.id, action: input.status === "confirmed" ? "cash.declaration_confirmed" : input.status === "discrepancy" ? "cash.discrepancy_recorded" : "cash.declaration_rejected", targetType: "cash_declaration", targetId: declaration.id, reason: input.notes }); revalidatePath("/club/shop"); revalidatePath("/club/reception"); return { ok: true }; } catch (error) { console.error("[club-shop] cash reconciliation failed", { operation: "reconcile_cash" }); return { ok: false, error: "Cash declaration couldn’t be updated." }; }
}

export async function adjustStockAction(input: { organisationId: string; locationId: string; productId: string; quantityDelta?: number; countedQuantity?: number; reason: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const value = await context(input.organisationId);
    if (!value || !["gym_staff", "gym_admin", "owner"].includes(value.member.role) || !(await value.repository.hasCapability(value.organisation.id, value.userId, "inventory.adjust"))) return { ok: false, error: "You don’t have permission to adjust stock." };
    const counted = input.countedQuantity !== undefined;
    const countedQuantity = input.countedQuantity;
    if ((!counted && (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0)) || (counted && (countedQuantity === undefined || !Number.isInteger(countedQuantity) || countedQuantity < 0)) || !input.locationId || !input.productId || !input.reason.trim()) return { ok: false, error: "Enter a valid stock quantity and reason." };
    let quantityDelta = input.quantityDelta ?? 0;
    if (counted) { const current = (await value.repository.listStockBalances(value.organisation.id, input.locationId)).find(item => item.productId === input.productId)?.onHand; quantityDelta = input.countedQuantity! - (current ?? 0); if (quantityDelta === 0) return { ok: true }; }
    await value.repository.adjustInventory({ organisationId: value.organisation.id, locationId: input.locationId, productId: input.productId, movementType: counted ? "stocktake_adjustment" : "manual_adjustment", quantityDelta, reason: input.reason.trim(), idempotencyKey: crypto.randomUUID() });
    await value.repository.appendAuditEvent({ organisationId: value.organisation.id, action: "inventory.adjusted", targetType: "commerce_product", targetId: input.productId, reason: input.reason.trim() });
    revalidatePath("/club/shop");
    return { ok: true };
  } catch (error) { console.error("[club-shop] stock adjustment failed", { operation: "adjust_inventory" }); return { ok: false, error: "Stock couldn’t be updated." }; }
}

export async function receiveDeliveryAction(input: { organisationId: string; locationId: string; supplierName?: string; supplierReference?: string; receivedAt?: string; notes?: string; lines: Array<{ productId: string; quantityReceived: number; unitCost?: string }> }): Promise<{ ok: true } | { ok: false; error: string }> {
  try { const value = await context(input.organisationId); if (!value || !["gym_staff", "gym_admin", "owner"].includes(value.member.role) || !(await value.repository.hasCapability(value.organisation.id, value.userId, "inventory.adjust"))) return { ok: false, error: "You don’t have permission to receive deliveries." }; if (!input.locationId || !input.lines.length || input.lines.some(line => !Number.isInteger(line.quantityReceived) || line.quantityReceived <= 0 || line.unitCost !== undefined && parseMinorUnits(line.unitCost) === undefined)) return { ok: false, error: "Add a venue and at least one valid delivery line." }; await value.repository.receiveInventoryDelivery({ organisationId: value.organisation.id, locationId: input.locationId, supplierName: input.supplierName, supplierReference: input.supplierReference, receivedAt: input.receivedAt, notes: input.notes, lines: input.lines.map(line => ({ productId: line.productId, quantityReceived: line.quantityReceived, ...(line.unitCost?.trim() ? { unitCostMinor: parseMinorUnits(line.unitCost)! } : {}) })), idempotencyKey: crypto.randomUUID() }); revalidatePath("/club/shop"); return { ok: true }; } catch { return { ok: false, error: "Delivery couldn’t be received." }; }
}

export async function saveCatalogueProductAction(input: { organisationId: string; id?: string; name: string; brand?: string; category?: string; price: string; costPrice?: string; barcode?: string; sku?: string; stockTracked: boolean; active: boolean; mediaUrl?: string }): Promise<{ ok: true; productName: string } | { ok: false; error: string }> {
  try {
    const value = await context(input.organisationId); const priceMinor = parseMinorUnits(input.price); const costPriceMinor = input.costPrice?.trim() ? parseMinorUnits(input.costPrice) : undefined;
    if (!value || !["gym_admin", "owner"].includes(value.member.role)) return { ok: false, error: "Catalogue editing is limited to Club administrators." };
    if (!input.name.trim() || priceMinor === undefined || costPriceMinor === undefined && input.costPrice?.trim()) return { ok: false, error: "Enter a product name and valid GBP prices." };
    const product = await value.repository.saveCommerceProduct({ id: input.id, organisationId: value.organisation.id, name: input.name.trim(), brand: input.brand?.trim() || undefined, category: input.category?.trim() || undefined, sellPriceMinor: priceMinor, ...(costPriceMinor !== undefined ? { costPriceMinor } : {}), currency: "GBP", barcode: input.barcode?.trim() || undefined, sku: input.sku?.trim() || undefined, stockTracked: input.stockTracked, active: input.active, ...(input.mediaUrl?.trim() ? { media: { url: input.mediaUrl.trim() } } : {}) });
    await value.repository.appendAuditEvent({ organisationId: value.organisation.id, action: input.id ? "catalogue.product_updated" : "catalogue.product_created", targetType: "commerce_product", targetId: product.id });
    revalidatePath("/club/shop"); return { ok: true, productName: product.name };
  } catch (error) { console.error("[club-shop] catalogue save failed", { operation: "save_commerce_product" }); return { ok: false, error: "Product couldn’t be saved." }; }
}

export async function lookupBarcodeAction(barcode: string) { const normalized = normalizeBarcode(barcode); if (!normalized) return { ok: false as const, error: "Enter an 8–14 digit barcode." }; const candidate = await new OpenFoodFactsBarcodeProvider().lookup(normalized); return candidate ? { ok: true as const, candidate } : { ok: false as const, error: "Couldn’t identify this product online. You can still add it manually." }; }

export async function importSupplierCatalogueAction(input: { organisationId: string; supplierName: string; fileName: string; rows: unknown[] }): Promise<{ ok: true; created: number; updated: number } | { ok: false; error: string }> {
  try {
    const value = await context(input.organisationId);
    if (!value || !["gym_admin", "owner"].includes(value.member.role) || !(await value.repository.hasCapability(value.organisation.id, value.userId, "supplier.catalogue_manage"))) return { ok: false, error: "You don’t have permission to import supplier products." };
    const { data, error } = await (await serverSupabase()).rpc("club_import_supplier_catalogue", { p_organisation_id: value.organisation.id, p_supplier_name: input.supplierName, p_file_name: input.fileName, p_rows: input.rows });
    if (error) return { ok: false, error: "Supplier catalogue could not be imported." };
    revalidatePath("/club/shop"); return { ok: true, created: Number(data?.created ?? 0), updated: Number(data?.updated ?? 0) };
  } catch { return { ok: false, error: "Supplier catalogue could not be imported." }; }
}

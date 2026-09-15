/** Provider-neutral commerce, settlement, balance and inventory contracts. */
export type ClubCommerceChannel = "member_app" | "staff_checkout" | "quick_sale" | "web" | "other";
export type ClubCommerceOrderStatus = "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "refunded";
export type ClubCommercePaymentMethod = "card" | "wallet" | "direct_debit" | "cash" | "bank_transfer" | "balance" | "complimentary" | "other";
export type ClubCommercePaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partially_refunded" | "cancelled";
export type ClubCommerceMovementType = "sale" | "delivery" | "transfer_in" | "transfer_out" | "return" | "waste" | "damage" | "complimentary" | "stocktake_adjustment" | "manual_adjustment";
export type ClubCommerceProduct = { id: string; organisationId: string; sku?: string; barcode?: string; name: string; brand?: string; description?: string; category?: string; active: boolean; stockTracked: boolean; sellPriceMinor: number; costPriceMinor?: number; currency: string; taxCode?: string; supplierReference?: string; supplierMemberOrderable?: boolean; supplierAvailabilityStatus?: "available" | "unavailable" | "unknown"; variantImageReference?: string; media?: Record<string, unknown>; enrichment?: { nutrition?: Record<string, unknown>; ingredients?: string; allergens?: string; servingSize?: string; servings?: number }; familyId?: string; variantOptions?: Record<string, string>; createdAt: string; updatedAt: string };
export function normalizeCatalogueSearch(value: string) { return value.toLocaleLowerCase().replace(/[\s\-_.\/]+/g, "").trim(); }
export function catalogueSearchMatches(product: ClubCommerceProduct, query: string) { const needle = normalizeCatalogueSearch(query); if (!needle) return true; return [product.name, product.brand, product.category, product.description, product.sku, product.barcode, product.supplierReference, ...Object.values(product.variantOptions ?? {})].some(value => normalizeCatalogueSearch(value ?? "").includes(needle)); }
export function usableCommerceImageUrl(value: unknown): value is string { if (typeof value !== "string" || !value.trim()) return false; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
/** Supplier-linked physical products remain stockable at zero local balance. */
export function isStockableCommerceProduct(product: ClubCommerceProduct) { return product.stockTracked || Boolean(product.supplierReference) || product.supplierAvailabilityStatus !== undefined; }

/** Keep physical club inventory at the front of operational catalogues. */
export function sortCommerceProductsForOperations(products: ClubCommerceProduct[]) {
  return products.slice().sort((a, b) => Number(b.stockTracked) - Number(a.stockTracked) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Legacy catalogue examples must never leak into live commerce surfaces. */
export function isLegacyDemoCommerceProduct(product: ClubCommerceProduct) {
  const text = `${product.name} ${product.category ?? ""}`.toLocaleLowerCase();
  return /(^|\b)(demo|test product|sample product)\b/.test(text) || /\b1kg\s+whey\s+isolate\b/.test(text);
}

/** Active Sports Monster 12-can cases are not a customer-orderable format. */
export function isActiveSportsMonsterCaseProduct(product: ClubCommerceProduct) {
  if (!product.supplierReference?.startsWith("supplier_product:")) return false;
  if (product.brand?.trim().toLocaleLowerCase() !== "monster energy") return false;
  const options = product.variantOptions ?? {};
  const text = `${product.name} ${options.size ?? ""} ${options.orderUnit ?? ""}`.toLocaleLowerCase();
  return /\b(?:case|box|pack)\b/.test(text) && /\b12\s*x\s*500\s*ml\b/.test(text);
}

/** Overlay member-safe supplier presentation metadata on an existing commerce
 * row without replacing its authoritative retail price or local stock flags. */
export function mergeSupplierPresentation(product: ClubCommerceProduct, supplier: ClubCommerceProduct): ClubCommerceProduct {
  const localUrl = usableCommerceImageUrl(product.media?.url) ? product.media.url : undefined;
  const supplierUrl = usableCommerceImageUrl(supplier.media?.url) ? supplier.media.url : undefined;
  const supplierManaged = supplier.supplierReference?.startsWith("supplier_product:") === true;
  return {
    ...product,
    supplierMemberOrderable: supplier.supplierMemberOrderable,
    supplierAvailabilityStatus: supplier.supplierAvailabilityStatus,
    supplierReference: product.supplierReference ?? supplier.supplierReference,
    variantImageReference: supplierManaged && supplier.variantImageReference ? supplier.variantImageReference : product.variantImageReference ?? supplier.variantImageReference,
    ...(supplierManaged && supplierUrl ? { media: { url: supplierUrl } } : localUrl ? { media: { url: localUrl } } : supplierUrl ? { media: { url: supplierUrl } } : {}),
    familyId: product.familyId ?? supplier.familyId,
    variantOptions: product.variantOptions ?? supplier.variantOptions,
  };
}
export type SaveClubCommerceProductInput = Omit<ClubCommerceProduct, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type ClubPaymentAccount = { id: string; organisationId: string; provider: string; purpose: string; capabilities: string[]; externalAccountReference?: string; status: string; createdAt: string; updatedAt: string };
export type ClubOrderItem = { id: string; orderId: string; productId: string; productName: string; sku?: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; stockTracked: boolean };
export type ClubOrder = { id: string; organisationId: string; locationId?: string; customerId?: string; userId?: string; channel: ClubCommerceChannel; status: ClubCommerceOrderStatus; currency: string; subtotalMinor: number; discountMinor: number; totalMinor: number; createdBy?: string; idempotencyKey?: string; items: ClubOrderItem[]; createdAt: string; updatedAt: string };
export type ClubPayment = { id: string; orderId: string; organisationId: string; paymentAccountId?: string; method: ClubCommercePaymentMethod; externalReference?: string; amountMinor: number; currency: string; status: ClubCommercePaymentStatus; createdAt: string; updatedAt: string };
export type ClubRefund = { id: string; paymentId: string; orderId: string; organisationId: string; amountMinor: number; reason?: string; externalReference?: string; createdBy?: string; createdAt: string };
export type ClubStockMovement = { id: string; organisationId: string; locationId: string; productId: string; movementType: ClubCommerceMovementType; quantityDelta: number; orderId?: string; reason?: string; actorUserId?: string; idempotencyKey?: string; occurredAt: string };
export type ClubStockBalance = { organisationId: string; locationId: string; productId: string; onHand?: number; reserved: number; availableToSell?: number };
export type ClubBalanceAccount = { id: string; organisationId: string; customerId?: string; userId?: string; currency: string; status: "active" | "suspended" | "closed"; balanceMinor: number };
export type ClubBalanceEntry = { id: string; accountId: string; organisationId: string; entryType: "top_up" | "purchase" | "refund" | "manual_credit" | "manual_debit" | "promotional_credit" | "expiry" | "adjustment"; amountDeltaMinor: number; balanceAfterMinor: number; orderId?: string; paymentId?: string; actorUserId?: string; reason?: string; idempotencyKey?: string; createdAt: string };
export type ClubStocktakeVariance = { expectedQuantity: number; countedQuantity: number; variance: number };
export type ClubInventoryReceipt = { id: string; organisationId: string; locationId: string; supplierName?: string; supplierReference?: string; receivedAt: string; receivedBy: string; notes?: string; createdAt: string };
export type ClubInventoryReceiptLineInput = { productId: string; quantityReceived: number; unitCostMinor?: number; vatRatePercent?: number; notes?: string };

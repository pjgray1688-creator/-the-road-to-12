import { normalizeBarcode } from "./club-barcode";
import { parseMinorUnits } from "./club-money";
import { parseCsvRecords } from "./club-csv";

export type SupplierStockStatus = "available" | "unavailable" | "unknown";
export type ClubSupplier = { id: string; name: string; memberOrderable: boolean; catalogueUrl?: string; replenishmentOnly?: boolean };
export type SupplierCatalogueVariant = { supplierId: string; parentKey: string; flavour?: string; size?: string; packQuantity?: number; supplierSku?: string; barcode?: string; stockStatus: SupplierStockStatus; availabilityCheckedAt?: string; memberOrderableUnit?: string; imageReference?: string };
export type SupplierCatalogueProduct = { parentKey: string; supplierId: string; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: SupplierCatalogueVariant[] };
export type SupplierCatalogueImportRow = Omit<SupplierCatalogueVariant, "supplierId" | "parentKey" | "imageReference"> & { supplier: string; name: string; brand?: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; parentImageReference?: string; variantImageReference?: string; parentKey?: string };
export type SupplierCatalogueStore = { suppliers: ClubSupplier[]; products: SupplierCatalogueProduct[]; retailPrices: Record<string, number> };
export type SupplierCatalogueImportSummary = { suppliers: number; parents: number; variants: number; created: number; updated: number; unchanged: number; errors: string[] };
export type DurableSupplierParentRow = { parentKey: string; supplierId: string; supplierName: string; memberOrderable: boolean; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: Array<SupplierCatalogueVariant & { id: string; retailPriceMinor?: number; clubProductId?: string; localStockTracked?: boolean }> };

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const stock = (value: unknown): SupplierStockStatus => /^(available|in stock|yes|true|1)$/i.test(String(value ?? "").trim()) ? "available" : /^(unavailable|out of stock|no|false|0|unavailable\s*-\s*dated\s*clearance)$/i.test(String(value ?? "").trim()) ? "unavailable" : "unknown";
export const ACTIVE_SPORTS_HEADERS = ["Supplier", "Brand", "Parent Product", "Category", "Subcategory", "Description", "Size / Format", "Variant / Flavour", "Pack Qty", "Member Order Unit", "Supplier Stock", "Stock Checked", "Supplier SKU", "Barcode", "Source URL", "Notes", "Parent Image URL", "Variant Image URL", "Image Status"] as const;
const headerKey = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
const unitValues = new Set(["unit", "case", "pack", "box", "tub", "each"]);
const validUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } };
export type ActiveSportsNormalisedRow = SupplierCatalogueImportRow & { notes?: string; imageStatus?: string; supplierStock: SupplierStockStatus; parentImageReference?: string; variantImageReference?: string } & ActiveSportsCommercialFields;
export type ActiveSportsImportResult = { rows: ActiveSportsNormalisedRow[]; errors: Array<{ row: number; reason: string }>; duplicateRows: number[]; headers: string[] };
export type ActiveSportsDuplicateRow = { row: number; productName: string; brand?: string; supplier: string; sku?: string; barcode?: string; variant?: string; size?: string; stock: SupplierStockStatus; costPriceMinor?: number; retailPriceMinor?: number; vatRate?: number; identityKey: string };
export type ActiveSportsDuplicateGroup = { identityKey: string; rows: ActiveSportsDuplicateRow[]; identical: boolean; autoIgnoredRows: number[]; conflictingRows: number[] };
export type CatalogueOperatorFilter = { query?: string; supplierId?: string; brand?: string; category?: string; availability?: SupplierStockStatus; priced?: boolean; memberOrderable?: boolean; sort?: "name" | "brand" | "unpriced" | "available" };
export function filterSupplierParents(parents: DurableSupplierParentRow[], filter: CatalogueOperatorFilter = {}) { const query = filter.query?.trim().toLowerCase(); const matches = parents.filter(parent => (!filter.supplierId || parent.supplierId === filter.supplierId) && (!filter.brand || parent.brand === filter.brand) && (!filter.category || parent.category === filter.category) && parent.variants.some(variant => (!filter.availability || variant.stockStatus === filter.availability) && (!filter.memberOrderable || parent.memberOrderable) && (!filter.priced || variant.retailPriceMinor !== undefined) && (!query || [parent.name,parent.brand,parent.category,parent.subcategory,variant.flavour,variant.size,variant.supplierSku,variant.barcode].some(value => value?.toLowerCase().includes(query))))); return matches.sort((a,b)=> filter.sort === "brand" ? (a.brand??"").localeCompare(b.brand??"") || a.name.localeCompare(b.name) : filter.sort === "unpriced" ? Number(a.variants.every(v=>v.retailPriceMinor!==undefined))-Number(b.variants.every(v=>v.retailPriceMinor!==undefined)) || a.name.localeCompare(b.name) : filter.sort === "available" ? Number(b.variants.some(v=>v.stockStatus === "available"))-Number(a.variants.some(v=>v.stockStatus === "available")) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)); }

/** Normalise catalogue facts and attach optional commercial fields to their original row. */
export function normalizeActiveSportsCsv(input: string): ActiveSportsImportResult {
  const records = parseCsvRecords(input); if (!records.length) return { rows: [], errors: [{ row: 1, reason: "CSV is empty" }], duplicateRows: [], headers: [] };
  const rawHeaders = Object.keys(records[0] as Record<string, unknown>); const lookup = new Map(rawHeaders.map(header => [headerKey(header), header]));
  const missing = ACTIVE_SPORTS_HEADERS.filter(header => !lookup.has(headerKey(header)));
  if (missing.length) return { rows: [], errors: [{ row: 1, reason: `Missing required catalogue headers: ${missing.join(", ")}` }], duplicateRows: [], headers: rawHeaders };
  const errors: ActiveSportsImportResult["errors"] = []; const duplicateRows: number[] = []; const seen = new Set<string>(); const rows: ActiveSportsNormalisedRow[] = [];
  const value = (record: Record<string, string>, header: string) => String(record[lookup.get(headerKey(header)) ?? header] ?? "").trim();
  records.forEach((recordValue, index) => { const record = recordValue as unknown as Record<string, string>; const rowNumber = index + 2; const supplierName = value(record, "Supplier"); const name = cleanSupplierProductName(value(record, "Parent Product")); if (!supplierName) errors.push({ row: rowNumber, reason: "Supplier is required" }); if (!name) errors.push({ row: rowNumber, reason: "Parent Product is required" }); const checked = value(record, "Stock Checked"); if (checked && Number.isNaN(Date.parse(checked))) errors.push({ row: rowNumber, reason: "Stock Checked must be a valid date/time" }); const sourceUrl = value(record, "Source URL"); if (sourceUrl && !validUrl(sourceUrl)) errors.push({ row: rowNumber, reason: "Source URL must be an http(s) URL" }); const orderUnit = value(record, "Member Order Unit"); if (orderUnit && !unitValues.has(orderUnit.toLowerCase())) errors.push({ row: rowNumber, reason: `Unsupported Member Order Unit: ${orderUnit}` }); const packRaw = value(record, "Pack Qty"); const packQuantity = packRaw ? Number(packRaw) : undefined; if (packRaw && (packQuantity === undefined || !Number.isInteger(packQuantity) || packQuantity < 1)) errors.push({ row: rowNumber, reason: "Pack Qty must be a positive whole number" }); const safePackQuantity = packQuantity !== undefined && Number.isInteger(packQuantity) && packQuantity > 0 ? packQuantity : undefined; const supplier = supplierName.toLowerCase().replace(/\s+/g, " "); const parentKey = `${value(record, "Brand").toLowerCase()}|${name.toLowerCase()}`; const sku = value(record, "Supplier SKU") || undefined; const barcode = value(record, "Barcode") || undefined; const identity = `${supplier}|${parentKey}|${value(record, "Size / Format").toLowerCase()}|${value(record, "Variant / Flavour").toLowerCase()}|${safePackQuantity ?? ""}|${orderUnit.toLowerCase()}|${sku ?? ""}|${barcode ?? ""}`; if (seen.has(identity)) duplicateRows.push(rowNumber); seen.add(identity); const commercial = parseActiveSportsCommercialFields(record); commercial.errors.forEach(reason => errors.push({ row: rowNumber, reason })); if (errors.some(error => error.row === rowNumber)) return; rows.push({ ...commercial.fields, supplier: supplierName, parentKey, name, brand: value(record, "Brand") || undefined, description: value(record, "Description") || undefined, category: value(record, "Category") || undefined, subcategory: value(record, "Subcategory") || undefined, sourceUrl: sourceUrl || undefined, parentImageReference: value(record, "Parent Image URL") || undefined, variantImageReference: value(record, "Variant Image URL") || undefined, flavour: value(record, "Variant / Flavour") || undefined, size: value(record, "Size / Format") || undefined, packQuantity: safePackQuantity, memberOrderableUnit: orderUnit || undefined, supplierSku: sku, barcode, stockStatus: stock(value(record, "Supplier Stock")), supplierStock: stock(value(record, "Supplier Stock")), availabilityCheckedAt: checked || undefined, notes: value(record, "Notes") || undefined, imageStatus: value(record, "Image Status") || undefined }); });
  return { rows, errors, duplicateRows, headers: rawHeaders };
}
/** Removes source promotion boilerplate while retaining the real product identity. */
export function cleanSupplierProductName(value: string) { return value.replace(/\b(?:SPECIAL OFFER|BLACK FRIDAY|FREE (?:SHAKER|PRODUCT|CREATINE)|EXTRA\s*\d*%?|BUY\s+\w+\s+GET\s+\w+)\b/gi, "").replace(/\b(?:BBE|VAT)\s*[:\-]?\s*\w+\b/gi, "").replace(/(?:\s*[|–—-]\s*)+$/g, "").replace(/\s{2,}/g, " ").trim(); }
export function parseSupplierCatalogueRows(input: string, supplier: ClubSupplier): SupplierCatalogueImportRow[] {
  return parseCsvRecords(input).flatMap(record => { const row = record as unknown as Record<string, string>; const name = cleanSupplierProductName(clean(row.name ?? row.product ?? row.product_name ?? row.parent_product) ?? ""); if (!name) return []; const sku = clean(row.supplier_sku ?? row.sku ?? row.supplier_product_code); const barcode = clean(row.barcode ?? row.ean ?? row.upc); const parsedPack = Number(row.pack_quantity ?? row.case_quantity ?? ""); return [{ supplier: supplier.id, parentKey: clean(row.parent_key) ?? name.toLowerCase(), name, ...(clean(row.brand) ? { brand: clean(row.brand) } : {}), ...(clean(row.description) ? { description: clean(row.description) } : {}), ...(clean(row.category) ? { category: clean(row.category) } : {}), ...(clean(row.subcategory) ? { subcategory: clean(row.subcategory) } : {}), ...(clean(row.source_url ?? row.product_url) ? { sourceUrl: clean(row.source_url ?? row.product_url) } : {}), ...(clean(row.image_reference ?? row.parent_image_url) ? { parentImageReference: clean(row.image_reference ?? row.parent_image_url) } : {}), ...(clean(row.variant_image_url) ? { variantImageReference: clean(row.variant_image_url) } : {}), ...(clean(row.variant ?? row.flavour) ? { flavour: clean(row.variant ?? row.flavour) } : {}), ...(clean(row.size) ? { size: clean(row.size) } : {}), ...(Number.isInteger(parsedPack) && parsedPack > 0 ? { packQuantity: parsedPack } : {}), ...(sku ? { supplierSku: sku } : {}), ...(barcode ? { barcode } : {}), stockStatus: stock(row.availability ?? row.stock), ...(clean(row.availability_checked_at ?? row.last_checked_at) ? { availabilityCheckedAt: clean(row.availability_checked_at ?? row.last_checked_at) } : {}), ...(clean(row.order_unit ?? row.member_orderable_unit) ? { memberOrderableUnit: clean(row.order_unit ?? row.member_orderable_unit) } : {}) } satisfies SupplierCatalogueImportRow]; });
}
export function groupSupplierCatalogue(rows: SupplierCatalogueImportRow[], supplier: ClubSupplier): SupplierCatalogueProduct[] {
  const grouped = new Map<string, SupplierCatalogueProduct>();
  for (const row of rows.filter(item => item.supplier === supplier.id)) { const existing = grouped.get(row.parentKey ?? row.name.toLowerCase()) ?? { parentKey: row.parentKey ?? row.name.toLowerCase(), supplierId: supplier.id, ...(row.brand ? { brand: row.brand } : {}), name: row.name, ...(row.description ? { description: row.description } : {}), ...(row.category ? { category: row.category } : {}), ...(row.subcategory ? { subcategory: row.subcategory } : {}), ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), ...(row.parentImageReference ? { imageReference: row.parentImageReference } : {}), variants: [] }; existing.variants.push({ supplierId: supplier.id, parentKey: existing.parentKey, flavour: row.flavour, size: row.size, packQuantity: row.packQuantity, supplierSku: row.supplierSku, barcode: row.barcode, stockStatus: row.stockStatus, availabilityCheckedAt: row.availabilityCheckedAt, memberOrderableUnit: row.memberOrderableUnit, ...(row.variantImageReference ? { imageReference: row.variantImageReference } : {}) }); grouped.set(existing.parentKey, existing); }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Deterministic, idempotent in-memory upsert used by the server importer and preview tests. */
export function upsertSupplierCatalogue(store: SupplierCatalogueStore, rows: SupplierCatalogueImportRow[], supplier: ClubSupplier, options: { reconcile?: boolean } = {}): SupplierCatalogueImportSummary {
  const summary: SupplierCatalogueImportSummary = { suppliers: 0, parents: 0, variants: 0, created: 0, updated: 0, unchanged: 0, errors: [] };
  const existingSupplier = store.suppliers.find(item => item.id === supplier.id);
  if (!existingSupplier) { store.suppliers.push({ ...supplier }); summary.suppliers = 1; }
  const products = groupSupplierCatalogue(rows, supplier);
  for (const product of products) {
    const current = store.products.find(item => item.supplierId === supplier.id && item.parentKey === product.parentKey);
    if (!current) { store.products.push({ ...product, variants: product.variants.map(variant => ({ ...variant })) }); summary.parents++; summary.variants += product.variants.length; summary.created += 1 + product.variants.length; continue; }
    const before = JSON.stringify(current);
    Object.assign(current, { ...product, variants: current.variants });
    for (const incoming of product.variants) {
      const identity = (variant: SupplierCatalogueVariant) => `${variant.supplierId}|${variant.parentKey}|${variant.supplierSku ?? ""}|${variant.barcode ?? ""}|${variant.size ?? ""}|${variant.flavour ?? ""}|${variant.packQuantity ?? ""}`;
      const found = current.variants.find(variant => identity(variant) === identity(incoming));
      if (found) Object.assign(found, incoming); else { current.variants.push({ ...incoming }); summary.variants++; summary.created++; }
    }
    if (JSON.stringify(current) === before) summary.unchanged++; else summary.updated++;
  }
  if (options.reconcile) {
    const keys = new Set(products.map(product => product.parentKey));
    for (const product of store.products.filter(item => item.supplierId === supplier.id && !keys.has(item.parentKey))) product.variants = product.variants.map(variant => ({ ...variant, stockStatus: "unknown" }));
  }
  return summary;
}

/** The member resolver should receive this boolean; unknown supplier stock is never orderable. */
export function supplierVariantOrderable(supplier: ClubSupplier, variant: SupplierCatalogueVariant) {
  return supplier.memberOrderable && variant.stockStatus === "available";
}

/** Convert member-safe durable rows into the existing grouped commerce-product shape. */
export function durableSupplierRowsToProducts(rows: DurableSupplierParentRow[], organisationId: string) {
  return rows.filter(parent => parent.memberOrderable && parent.variants.some(variant => variant.stockStatus === "available")).flatMap(parent => parent.variants.map(variant => ({ id: variant.clubProductId ?? variant.id, organisationId, sku: variant.supplierSku, barcode: variant.barcode, name: parent.name, brand: parent.brand, description: parent.description, category: parent.category, active: true, stockTracked: variant.localStockTracked === true, sellPriceMinor: variant.retailPriceMinor ?? 0, currency: "GBP", supplierReference: variant.supplierSku, supplierMemberOrderable: parent.memberOrderable, supplierAvailabilityStatus: variant.stockStatus, variantImageReference: variant.imageReference, media: parent.imageReference ? { url: parent.imageReference } : undefined, familyId: `${parent.supplierId}:${parent.parentKey}`, variantOptions: Object.fromEntries([["orderUnit", variant.memberOrderableUnit], ["flavour", variant.flavour], ["size", variant.size], ["packQuantity", variant.packQuantity ? String(variant.packQuantity) : undefined]].filter((entry): entry is [string, string] => Boolean(entry[1]))), createdAt: "", updatedAt: "" })));
}

/** Return only real variants for a selected size; never cross-product flavours. */
export function variantsForSize(product: SupplierCatalogueProduct, size?: string) {
  return product.variants.filter(variant => !size || variant.size === size);
}

/** Prefer a genuine variant image, then the parent image, then the shared R12 placeholder. */
export function resolveSupplierProductImage(product: SupplierCatalogueProduct, variant?: SupplierCatalogueVariant, placeholder = "r12-product-placeholder") {
  return variant?.imageReference ?? product.imageReference ?? placeholder;
}

/** Resolve an incoming supplier reference without accepting ambiguous matches. */
export function resolveSupplierVariantReference(input: { supplierSku?: string; barcode?: string; canonicalVariantId?: string }, variants: Array<{ canonicalVariantId: string; supplierSku?: string; barcode?: string }>) {
  const match = (key: "supplierSku" | "barcode" | "canonicalVariantId", value?: string) => value ? variants.filter(variant => variant[key] === value) : [];
  for (const [key, value] of [["supplierSku", input.supplierSku], ["barcode", input.barcode], ["canonicalVariantId", input.canonicalVariantId]] as const) {
    const matches = match(key, value);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

/** Commercial fields accepted by the reviewed Active Sports import. These stay
 * operator-side until a catalogue row has been deliberately published. */
export type ActiveSportsCommercialFields = {
  currentBoldTradeCostExVatMinor?: number;
  purchaseVatRate?: number;
  purchaseVatTreatment?: "standard" | "vat_free" | "review";
  trueCostMinor?: number;
  targetMargin?: number;
  suggestedRetailMinor?: number;
  finalRetailMinor?: number;
  costStatus?: string;
  costSourceSnapshot?: string;
};

const commercialHeaderAliases: Record<keyof ActiveSportsCommercialFields, string[]> = {
  currentBoldTradeCostExVatMinor: ["Trade Cost ex VAT", "Current Bold Trade Cost ex VAT", "Current Bold Trade Cost ex VAT (minor)"],
  purchaseVatRate: ["VAT Rate", "Purchase VAT Rate"],
  purchaseVatTreatment: ["VAT Treatment", "Purchase VAT Treatment"],
  trueCostMinor: ["True Cost", "True Cost (minor)"],
  targetMargin: ["Target Margin", "Target Margin %"],
  suggestedRetailMinor: ["Suggested Retail", "Suggested Retail (minor)"],
  finalRetailMinor: ["Final / Live Retail", "Final Retail", "Live Retail"],
  costStatus: ["Cost Status"],
  costSourceSnapshot: ["Cost Source / Snapshot", "Cost Source Snapshot"]
};

const cleanHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
const commercialHeaderLookup = (record: Record<string, unknown>) => new Map(Object.keys(record).map(key => [cleanHeader(key), key]));
const readCommercialField = (record: Record<string, unknown>, lookup: Map<string, string>, key: keyof ActiveSportsCommercialFields) => {
  for (const alias of commercialHeaderAliases[key]) {
    const source = lookup.get(cleanHeader(alias));
    if (source) {
      const value = String(record[source] ?? "").trim();
      if (value) return value;
    }
  }
  return undefined;
};

/** Parse optional commercial columns without making them customer-visible or
 * inventing missing supplier economics. Money accepts GBP text or minor units
 * when the header explicitly says minor. */
export function parseActiveSportsCommercialFields(record: Record<string, unknown>): { fields: ActiveSportsCommercialFields; errors: string[] } {
  const lookup = commercialHeaderLookup(record);
  const errors: string[] = [];
  const money = (key: keyof ActiveSportsCommercialFields) => {
    const raw = readCommercialField(record, lookup, key);
    if (raw === undefined) return undefined;
    const minorHeader = commercialHeaderAliases[key].some(alias => /minor/i.test(alias) && lookup.has(cleanHeader(alias)));
    const value = minorHeader && /^\d+$/.test(raw) ? Number(raw) : !minorHeader ? parseMinorUnits(raw.replace(/^£\s*/, "")) : undefined;
    if (value === undefined || !Number.isSafeInteger(value) || value < 0 || value > 100000000) { errors.push(`${String(key)} must be a non-negative amount`); return undefined; }
    return value;
  };
  const percentage = (key: keyof ActiveSportsCommercialFields) => {
    const raw = readCommercialField(record, lookup, key);
    if (raw === undefined) return undefined;
    const value = key === "purchaseVatRate" && /^vat[ _-]*free$/i.test(raw) ? 0 : /^\d+(?:\.\d+)?%?$/.test(raw) ? Number(raw.replace(/%/g, "")) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 100) { errors.push(`${String(key)} must be between 0 and 100`); return undefined; }
    return key === "purchaseVatRate" && !raw.includes("%") && value <= 1 ? value : value / 100;
  };
  const treatmentRaw = readCommercialField(record, lookup, "purchaseVatTreatment")?.toLowerCase();
  const treatment = treatmentRaw === undefined ? undefined : /free|zero/.test(treatmentRaw) ? "vat_free" as const : /standard|20/.test(treatmentRaw) ? "standard" as const : /review|other/.test(treatmentRaw) ? "review" as const : undefined;
  if (treatmentRaw && !treatment) errors.push("purchaseVatTreatment must be standard, vat free/zero-rated, or review");
  const tradeCost = money("currentBoldTradeCostExVatMinor");
  const vatRate = percentage("purchaseVatRate");
  if (treatment === "vat_free" && vatRate !== undefined && vatRate !== 0) errors.push("VAT treatment conflicts with explicit VAT Rate");
  const trueCost = money("trueCostMinor");
  const targetMargin = percentage("targetMargin");
  const suggestedRetail = money("suggestedRetailMinor");
  const finalRetail = money("finalRetailMinor");
  const costStatus = readCommercialField(record, lookup, "costStatus");
  const costSourceSnapshot = readCommercialField(record, lookup, "costSourceSnapshot");
  const fields: ActiveSportsCommercialFields = {
    ...(tradeCost === undefined ? {} : { currentBoldTradeCostExVatMinor: tradeCost }),
    ...(vatRate === undefined ? {} : { purchaseVatRate: vatRate }),
    ...(treatment ? { purchaseVatTreatment: treatment } : {}),
    ...(trueCost === undefined ? {} : { trueCostMinor: trueCost }),
    ...(targetMargin === undefined ? {} : { targetMargin }),
    ...(suggestedRetail === undefined ? {} : { suggestedRetailMinor: suggestedRetail }),
    ...(finalRetail === undefined ? {} : { finalRetailMinor: finalRetail }),
    ...(costStatus ? { costStatus } : {}),
    ...(costSourceSnapshot ? { costSourceSnapshot } : {})
  };
  return { fields, errors };
}

/** Reconcile supplier availability conservatively: a parent is orderable only
 * when at least one exact, available variant has been reviewed. */
export function supplierParentCanBeOrdered(supplier: ClubSupplier, parent: SupplierCatalogueProduct, hasRetailPrice: (variant: SupplierCatalogueVariant) => boolean = () => true) {
  return supplier.memberOrderable && parent.variants.some(variant => supplierVariantOrderable(supplier, variant) && hasRetailPrice(variant));
}

/** Supplier order units are never silently converted from a case into a single
 * sellable unit. The caller must explicitly choose the supplier's order unit. */
export function supplierOrderQuantity(variant: Pick<SupplierCatalogueVariant, "packQuantity" | "memberOrderableUnit">, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("invalid_supplier_order_quantity");
  const unit = variant.memberOrderableUnit?.toLowerCase();
  if (!unit) throw new Error("supplier_order_unit_required");
  return { quantity, unit, packQuantity: variant.packQuantity ?? 1, isCaseOrBox: unit === "case" || unit === "box" };
}

const likelyPlaceholderImage = /placeholder|no[-_ ]?image|coming[-_ ]?soon|default[-_ ]?product/i;
/** Validate imported imagery before it is allowed into a customer-facing
 * catalogue; invalid/placeholder URLs fall back to parent or no image. */
export function resolveValidatedSupplierImage(product: SupplierCatalogueProduct, variant?: SupplierCatalogueVariant) {
  const candidates = [variant?.imageReference, product.imageReference].filter((value): value is string => Boolean(value));
  return candidates.find(value => { try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !likelyPlaceholderImage.test(url.pathname + url.search); } catch { return false; } });
}

export function activeSportsReconciliationReport(rows: ActiveSportsNormalisedRow[], errors: Array<{ row: number; reason: string }> = [], duplicateRows: number[] = []) {
  const parents = new Set(rows.map(row => row.parentKey));
  const image = (row: ActiveSportsNormalisedRow) => resolveValidatedSupplierImage({ parentKey: String(row.parentKey ?? ""), supplierId: String(row.supplier ?? ""), name: row.name, imageReference: row.parentImageReference, variants: [] }, row.variantImageReference ? { supplierId: String(row.supplier ?? ""), parentKey: String(row.parentKey ?? ""), imageReference: row.variantImageReference, stockStatus: row.stockStatus } : undefined);
  return { parentProducts: parents.size, exactVariants: rows.length, fullyCostedVariants: rows.filter(row => row.currentBoldTradeCostExVatMinor !== undefined).length, missingCost: rows.filter(row => row.currentBoldTradeCostExVatMinor === undefined).length, explicitVatFree: rows.filter(row => row.purchaseVatTreatment === "vat_free").length, standardVat: rows.filter(row => row.purchaseVatTreatment === "standard").length, vatReview: rows.filter(row => row.purchaseVatTreatment === "review" || row.purchaseVatTreatment === undefined).length, supplierOrderable: rows.filter(row => row.supplierStock === "available").length, supplierUnavailable: rows.filter(row => row.supplierStock === "unavailable").length, missingSku: rows.filter(row => !row.supplierSku).length, missingBarcode: rows.filter(row => !row.barcode).length, validParentOrVariantImage: rows.filter(row => Boolean(image(row))).length, missingOrRejectedImage: rows.filter(row => !image(row)).length, duplicateRows: duplicateRows.length, parseErrors: errors.length, requiresManagementReview: rows.filter(row => row.currentBoldTradeCostExVatMinor === undefined || row.purchaseVatTreatment === "review" || !image(row)).length + duplicateRows.length + errors.length };
}

/** Integer-penny landed cost. Supplier VAT is unrecoverable; no sales VAT is deducted. */
export function supplierPricing(tradeCostMinor: number, vatRate: number, livePriceMinor?: number) {
  if (!Number.isSafeInteger(tradeCostMinor) || tradeCostMinor < 0 || tradeCostMinor > 100000000 || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) throw new Error("Invalid supplier cost or VAT");
  const trueCostMinor = Math.round(tradeCostMinor * (1 + vatRate));
  // 30% gross margin and upward whole-pound rounding, without float boundary drift.
  const recommendedFloorMinor = Math.ceil(trueCostMinor / 70) * 100;
  const live = livePriceMinor ?? recommendedFloorMinor;
  return { trueCostMinor, recommendedFloorMinor, livePriceMinor: live, marginPercent: live > 0 ? (live - trueCostMinor) / live * 100 : null, belowFloor: live < recommendedFloorMinor };
}

export function activeSportsIdentity(row: SupplierCatalogueImportRow) {
  const normal = (value?: string) => value?.trim().toLowerCase() ?? "";
  const variant = normal(row.flavour) || normal(row.name);
  const size = normal(row.size);
  const reference = row.supplierSku ? `sku:${normal(row.supplierSku)}` : row.barcode ? `barcode:${normal(row.barcode)}` : "facts";
  const product = reference === "facts" ? `|product:${normal(row.name)}` : "";
  return `${reference}${product}|variant:${variant}|size:${size}|pack:${row.packQuantity ?? 1}|unit:${normal(row.memberOrderableUnit)}`;
}

/** Final-file gate. Historical review exports can still be inspected by the legacy parser,
 * but only complete supplier facts enter the authenticated reconciler. Retail columns
 * are ignored: R12 owns recommendations and management owns approved live prices. */
export function prepareActiveSportsImport(csv: string, options: { duplicateChoices?: Record<string, number> } = {}) {
  let sourceRows = 0;
  try { sourceRows = parseCsvRecords(csv, true).length; } catch (error) {
    return { rows: [], errors: [{ row: 1, reason: String(error instanceof Error ? error.message : error) }], duplicateRows: [], duplicateGroups: [] as ActiveSportsDuplicateGroup[], summary: { sourceRows: 0, retainedParentProducts: 0, exactVariants: 0, supplierOrderableVariants: 0, unavailableSiblingsRetained: 0, excludedParents: 0, rejectedRows: 1, duplicateIdentities: 0, missingCommercialData: 0, vatFreeCount: 0, standardVatCount: 0, autoIgnoredDuplicates: 0, conflictingDuplicates: 0 } };
  }
  const result = normalizeActiveSportsCsv(csv);
  const errors = [...result.errors]; const duplicates = new Set<number>();
  const rows = result.rows.map(row => {
    const trade = row.currentBoldTradeCostExVatMinor;
    // Explicit VAT FREE remains zero. Blank VAT defaults to 20%; never replace explicit rates.
    const vat = row.purchaseVatRate ?? (row.purchaseVatTreatment === "vat_free" ? 0 : 0.2);
    return { ...row, purchaseVatRate: vat, purchaseVatTreatment: vat === 0 ? "vat_free" as const : "standard" as const, currentBoldTradeCostExVatMinor: trade, memberOrderableUnit: row.memberOrderableUnit?.toLowerCase(), identity: activeSportsIdentity(row) };
  });
  const records = parseCsvRecords(csv);
  const duplicateCandidates: Array<{ detail: ActiveSportsDuplicateRow; keys: string[]; signature: string }> = [];
  let missingCommercialData = 0;
  records.forEach((record, index) => {
    const row = index + 2;
    const fields = parseActiveSportsCommercialFields(record);
    if (record.barcode?.trim() && !normalizeBarcode(record.barcode)) errors.push({ row, reason: "Barcode must contain 8–14 digits, preserved as text" });
    if (fields.fields.currentBoldTradeCostExVatMinor === undefined) { missingCommercialData++; errors.push({ row, reason: "Trade Cost ex VAT is required and must be a non-negative GBP amount" }); }
    if (!/^(active sports|active sports nutrition)$/i.test(record.supplier?.trim() ?? "")) errors.push({ row, reason: "Supplier must be Active Sports or Active Sports Nutrition" });
    for (const key of ["brand", "category", "size / format", "member order unit", "stock checked", "cost source / snapshot"]) if (!record[key]?.trim()) errors.push({ row, reason: `${key} is required` });
    if (!/^(available|in stock|unavailable|out of stock|unavailable\s*-\s*dated\s*clearance)$/i.test(record["supplier stock"] ?? "")) errors.push({ row, reason: "Supplier Stock must be In stock or Out of stock" });
    if (/^(case|box|pack)$/i.test(record["member order unit"] ?? "") && !/^\d+$/.test(record["pack qty"] ?? "")) errors.push({ row, reason: "Pack Qty is required for a case, box or pack" });
    const candidate = { supplier: record.supplier || "", name: cleanSupplierProductName(record["parent product"] ?? ""), brand: record.brand || undefined, size: record["size / format"] || undefined, flavour: record["variant / flavour"] || undefined, packQuantity: Number(record["pack qty"] || 1), memberOrderableUnit: record["member order unit"] || undefined, supplierSku: record["supplier sku"] || undefined, barcode: record.barcode || undefined, stockStatus: stock(record["supplier stock"]) };
    const normal = (value?: string) => value?.trim().toLowerCase() ?? "";
    const variant = normal(candidate.flavour) || normal(candidate.name);
    const reference = candidate.supplierSku ? `sku:${normal(candidate.supplierSku)}` : candidate.barcode ? `barcode:${normal(candidate.barcode)}` : "facts";
    const product = reference === "facts" ? `:product:${normal(candidate.name)}` : "";
    const keys = [`${candidate.supplier.toLowerCase()}:${reference}${product}:variant:${variant}:size:${normal(candidate.size)}:pack:${candidate.packQuantity || 1}:unit:${normal(candidate.memberOrderableUnit)}`];
    const signature = JSON.stringify({ ...Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.trim()])), commercial: fields.fields });
    duplicateCandidates.push({ detail: { row, productName: candidate.name, brand: candidate.brand, supplier: candidate.supplier, sku: candidate.supplierSku, barcode: candidate.barcode, variant: candidate.flavour, size: candidate.size, stock: candidate.stockStatus, costPriceMinor: fields.fields.currentBoldTradeCostExVatMinor, retailPriceMinor: fields.fields.finalRetailMinor, vatRate: fields.fields.purchaseVatRate, identityKey: keys[0] ?? "" }, keys, signature });
  });
  const baseInvalidRows = new Set(errors.map(error => error.row));
  const duplicateGroups: ActiveSportsDuplicateGroup[] = [];
  const visited = new Set<number>();
  for (const candidate of duplicateCandidates) {
    if (visited.has(candidate.detail.row)) continue;
    const group = [candidate];
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const other of duplicateCandidates) {
        if (!group.includes(other) && other.keys.some(key => group.some(item => item.keys.includes(key)))) {
          group.push(other);
          expanded = true;
        }
      }
    }
    if (group.length < 2) continue;
    group.forEach(item => visited.add(item.detail.row));
    const identical = group.every(item => item.signature === group[0].signature);
    const identityKey = candidate.keys[0] ?? candidate.detail.identityKey;
    const selectedRow = options.duplicateChoices?.[identityKey];
    const chosen = !identical && selectedRow !== undefined && group.some(item => item.detail.row === selectedRow) ? selectedRow : undefined;
    const autoIgnoredRows = identical ? group.slice(1).map(item => item.detail.row) : chosen === undefined ? [] : group.filter(item => item.detail.row !== chosen).map(item => item.detail.row);
    const conflictingRows = identical || chosen !== undefined ? [] : group.map(item => item.detail.row);
    duplicateGroups.push({ identityKey, rows: group.map(item => ({ ...item.detail, identityKey })), identical, autoIgnoredRows, conflictingRows });
    if (identical || chosen !== undefined) autoIgnoredRows.forEach(rowNumber => duplicates.add(rowNumber));
    else if (chosen === undefined) conflictingRows.forEach(rowNumber => { duplicates.add(rowNumber); errors.push({ row: rowNumber, reason: `Conflicting duplicate identity ${identityKey}` }); });
  }
  const ignoredRows = new Set(duplicateGroups.flatMap(group => group.autoIgnoredRows));
  const validRowNumbers = records.map((_, index) => index + 2).filter(rowNumber => !baseInvalidRows.has(rowNumber));
  const dedupedRows = rows.filter((_, index) => !ignoredRows.has(validRowNumbers[index]));
  const availableParents = new Set(rows.filter(row => row.stockStatus === "available").map(row => row.parentKey));
  const retained = dedupedRows.filter(row => availableParents.has(row.parentKey));
  return { rows: dedupedRows, errors, duplicateRows: [...duplicates].filter(rowNumber => !ignoredRows.has(rowNumber)), duplicateGroups, summary: { sourceRows, retainedParentProducts: availableParents.size, exactVariants: retained.length, supplierOrderableVariants: retained.filter(row => row.stockStatus === "available").length, unavailableSiblingsRetained: retained.filter(row => row.stockStatus === "unavailable").length, excludedParents: new Set(rows.filter(row => !availableParents.has(row.parentKey)).map(row => row.parentKey)).size, rejectedRows: new Set(errors.map(error => error.row)).size, duplicateIdentities: duplicateGroups.length, autoIgnoredDuplicates: duplicateGroups.reduce((count, group) => count + group.autoIgnoredRows.length, 0), conflictingDuplicates: duplicateGroups.reduce((count, group) => count + group.conflictingRows.length, 0), missingCommercialData, vatFreeCount: retained.filter(row => row.purchaseVatRate === 0).length, standardVatCount: retained.filter(row => row.purchaseVatRate === 0.2).length } };
}

export type SupplierPricingOffer = {
  id: string; club_product_id: string | null; supplier: string; brand: string | null; name: string; variant: string | null; size: string | null; category: string | null;
  supplier_sku: string | null; barcode: string | null; availability_status: SupplierStockStatus; availability_checked_at: string | null;
  member_orderable_unit: string | null; pack_quantity: number | null; trade_cost_minor: number | null; vat_rate: number | null;
  retail_price_minor: number | null; manual_price: boolean; local_stock: number; cost_source: string | null;
  cost_history: Array<{ cost_minor: number; supplied_vat_rate: number | null; source_reference: string | null; observed_at: string; created_at: string }>;
};

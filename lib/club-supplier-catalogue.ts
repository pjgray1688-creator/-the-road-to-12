import { parseCsvRecords } from "./club-csv";

export type SupplierStockStatus = "available" | "unavailable" | "unknown";
export type ClubSupplier = { id: string; name: string; memberOrderable: boolean; catalogueUrl?: string; replenishmentOnly?: boolean };
export type SupplierCatalogueVariant = { supplierId: string; parentKey: string; flavour?: string; size?: string; packQuantity?: number; supplierSku?: string; barcode?: string; stockStatus: SupplierStockStatus; availabilityCheckedAt?: string; memberOrderableUnit?: string; imageReference?: string };
export type SupplierCatalogueProduct = { parentKey: string; supplierId: string; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: SupplierCatalogueVariant[] };
export type SupplierCatalogueImportRow = Omit<SupplierCatalogueVariant, "supplierId" | "parentKey" | "imageReference"> & { supplier: string; name: string; brand?: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; parentImageReference?: string; variantImageReference?: string; parentKey?: string };
export type SupplierCatalogueStore = { suppliers: ClubSupplier[]; products: SupplierCatalogueProduct[]; retailPrices: Record<string, number> };
export type SupplierCatalogueImportSummary = { suppliers: number; parents: number; variants: number; created: number; updated: number; unchanged: number; errors: string[] };
export type DurableSupplierParentRow = { parentKey: string; supplierId: string; supplierName: string; memberOrderable: boolean; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: Array<SupplierCatalogueVariant & { id: string; retailPriceMinor?: number; clubProductId?: string }> };

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const stock = (value: unknown): SupplierStockStatus => /^(available|in stock|yes|true|1)$/i.test(String(value ?? "").trim()) ? "available" : /^(unavailable|out of stock|no|false|0|unavailable\s*-\s*dated\s*clearance)$/i.test(String(value ?? "").trim()) ? "unavailable" : "unknown";
export const ACTIVE_SPORTS_HEADERS = ["Supplier", "Brand", "Parent Product", "Category", "Subcategory", "Description", "Size / Format", "Variant / Flavour", "Pack Qty", "Member Order Unit", "Supplier Stock", "Stock Checked", "Supplier SKU", "Barcode", "Source URL", "Notes", "Parent Image URL", "Variant Image URL", "Image Status"] as const;
const headerKey = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
const unitValues = new Set(["unit", "case", "pack", "box", "tub", "each"]);
const validUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } };
export type ActiveSportsNormalisedRow = SupplierCatalogueImportRow & { notes?: string; imageStatus?: string; supplierStock: SupplierStockStatus; parentImageReference?: string; variantImageReference?: string };
export type ActiveSportsImportResult = { rows: ActiveSportsNormalisedRow[]; errors: Array<{ row: number; reason: string }>; duplicateRows: number[]; headers: string[] };
export type CatalogueOperatorFilter = { query?: string; supplierId?: string; brand?: string; category?: string; availability?: SupplierStockStatus; priced?: boolean; memberOrderable?: boolean; sort?: "name" | "brand" | "unpriced" | "available" };
export function filterSupplierParents(parents: DurableSupplierParentRow[], filter: CatalogueOperatorFilter = {}) { const query = filter.query?.trim().toLowerCase(); const matches = parents.filter(parent => (!filter.supplierId || parent.supplierId === filter.supplierId) && (!filter.brand || parent.brand === filter.brand) && (!filter.category || parent.category === filter.category) && parent.variants.some(variant => (!filter.availability || variant.stockStatus === filter.availability) && (!filter.memberOrderable || parent.memberOrderable) && (!filter.priced || variant.retailPriceMinor !== undefined) && (!query || [parent.name,parent.brand,parent.category,parent.subcategory,variant.flavour,variant.size,variant.supplierSku,variant.barcode].some(value => value?.toLowerCase().includes(query))))); return matches.sort((a,b)=> filter.sort === "brand" ? (a.brand??"").localeCompare(b.brand??"") || a.name.localeCompare(b.name) : filter.sort === "unpriced" ? Number(a.variants.every(v=>v.retailPriceMinor!==undefined))-Number(b.variants.every(v=>v.retailPriceMinor!==undefined)) || a.name.localeCompare(b.name) : filter.sort === "available" ? Number(b.variants.some(v=>v.stockStatus === "available"))-Number(a.variants.some(v=>v.stockStatus === "available")) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)); }

/** Normalise the exact Catalogue-sheet export; no supplier price fields are accepted. */
export function normalizeActiveSportsCsv(input: string): ActiveSportsImportResult {
  const records = parseCsvRecords(input); if (!records.length) return { rows: [], errors: [{ row: 1, reason: "CSV is empty" }], duplicateRows: [], headers: [] };
  const rawHeaders = Object.keys(records[0] as Record<string, unknown>); const lookup = new Map(rawHeaders.map(header => [headerKey(header), header]));
  const missing = ACTIVE_SPORTS_HEADERS.filter(header => !lookup.has(headerKey(header)));
  if (missing.length) return { rows: [], errors: [{ row: 1, reason: `Missing required catalogue headers: ${missing.join(", ")}` }], duplicateRows: [], headers: rawHeaders };
  const errors: ActiveSportsImportResult["errors"] = []; const duplicateRows: number[] = []; const seen = new Set<string>(); const rows: ActiveSportsNormalisedRow[] = [];
  const value = (record: Record<string, string>, header: string) => String(record[lookup.get(headerKey(header)) ?? header] ?? "").trim();
  records.forEach((recordValue, index) => { const record = recordValue as unknown as Record<string, string>; const rowNumber = index + 2; const supplierName = value(record, "Supplier"); const name = cleanSupplierProductName(value(record, "Parent Product")); if (!supplierName) errors.push({ row: rowNumber, reason: "Supplier is required" }); if (!name) errors.push({ row: rowNumber, reason: "Parent Product is required" }); const checked = value(record, "Stock Checked"); if (checked && Number.isNaN(Date.parse(checked))) errors.push({ row: rowNumber, reason: "Stock Checked must be a valid date/time" }); const sourceUrl = value(record, "Source URL"); if (sourceUrl && !validUrl(sourceUrl)) errors.push({ row: rowNumber, reason: "Source URL must be an http(s) URL" }); const orderUnit = value(record, "Member Order Unit"); if (orderUnit && !unitValues.has(orderUnit.toLowerCase())) errors.push({ row: rowNumber, reason: `Unsupported Member Order Unit: ${orderUnit}` }); const packRaw = value(record, "Pack Qty"); const packQuantity = packRaw ? Number(packRaw) : undefined; if (packRaw && (packQuantity === undefined || !Number.isInteger(packQuantity) || packQuantity < 1)) errors.push({ row: rowNumber, reason: "Pack Qty must be a positive whole number" }); const safePackQuantity = packQuantity !== undefined && Number.isInteger(packQuantity) && packQuantity > 0 ? packQuantity : undefined; const supplier = supplierName.toLowerCase().replace(/\s+/g, " "); const parentKey = `${value(record, "Brand").toLowerCase()}|${name.toLowerCase()}`; const sku = value(record, "Supplier SKU") || undefined; const barcode = value(record, "Barcode") || undefined; const identity = `${supplier}|${parentKey}|${value(record, "Size / Format").toLowerCase()}|${value(record, "Variant / Flavour").toLowerCase()}|${safePackQuantity ?? ""}|${orderUnit.toLowerCase()}|${sku ?? ""}|${barcode ?? ""}`; if (seen.has(identity)) duplicateRows.push(rowNumber); seen.add(identity); if (errors.some(error => error.row === rowNumber)) return; rows.push({ supplier: supplierName, parentKey, name, brand: value(record, "Brand") || undefined, description: value(record, "Description") || undefined, category: value(record, "Category") || undefined, subcategory: value(record, "Subcategory") || undefined, sourceUrl: sourceUrl || undefined, parentImageReference: value(record, "Parent Image URL") || undefined, variantImageReference: value(record, "Variant Image URL") || undefined, flavour: value(record, "Variant / Flavour") || undefined, size: value(record, "Size / Format") || undefined, packQuantity: safePackQuantity, memberOrderableUnit: orderUnit || undefined, supplierSku: sku, barcode, stockStatus: stock(value(record, "Supplier Stock")), supplierStock: stock(value(record, "Supplier Stock")), availabilityCheckedAt: checked || undefined, notes: value(record, "Notes") || undefined, imageStatus: value(record, "Image Status") || undefined }); });
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
  return rows.flatMap(parent => parent.variants.map(variant => ({ id: variant.clubProductId ?? variant.id, organisationId, sku: variant.supplierSku, barcode: variant.barcode, name: parent.name, brand: parent.brand, description: parent.description, category: parent.category, active: true, stockTracked: Boolean(variant.clubProductId), sellPriceMinor: variant.retailPriceMinor ?? 0, currency: "GBP", supplierReference: variant.supplierSku, supplierMemberOrderable: parent.memberOrderable, supplierAvailabilityStatus: variant.stockStatus, variantImageReference: variant.imageReference, media: parent.imageReference ? { url: parent.imageReference } : undefined, familyId: `${parent.supplierId}:${parent.parentKey}`, variantOptions: Object.fromEntries([["flavour", variant.flavour], ["size", variant.size], ["packQuantity", variant.packQuantity ? String(variant.packQuantity) : undefined]].filter((entry): entry is [string, string] => Boolean(entry[1]))), createdAt: "", updatedAt: "" })));
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

import { parseCsvRecords } from "./club-csv";

export type SupplierStockStatus = "available" | "unavailable" | "unknown";
export type ClubSupplier = { id: string; name: string; memberOrderable: boolean; catalogueUrl?: string; replenishmentOnly?: boolean };
export type SupplierCatalogueVariant = { supplierId: string; parentKey: string; flavour?: string; size?: string; packQuantity?: number; supplierSku?: string; barcode?: string; stockStatus: SupplierStockStatus; availabilityCheckedAt?: string; memberOrderableUnit?: string; imageReference?: string };
export type SupplierCatalogueProduct = { parentKey: string; supplierId: string; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: SupplierCatalogueVariant[] };
export type SupplierCatalogueImportRow = Omit<SupplierCatalogueVariant, "supplierId" | "parentKey" | "imageReference"> & { supplier: string; name: string; brand?: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; parentImageReference?: string; variantImageReference?: string; parentKey?: string };
export type SupplierCatalogueStore = { suppliers: ClubSupplier[]; products: SupplierCatalogueProduct[]; retailPrices: Record<string, number> };
export type SupplierCatalogueImportSummary = { suppliers: number; parents: number; variants: number; created: number; updated: number; unchanged: number; errors: string[] };

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const stock = (value: unknown): SupplierStockStatus => /^(available|in stock|yes|true|1)$/i.test(String(value ?? "")) ? "available" : /^(unavailable|out of stock|no|false|0)$/i.test(String(value ?? "")) ? "unavailable" : "unknown";
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

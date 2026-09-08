import { parseCsvRecords } from "./club-csv";

export type SupplierStockStatus = "available" | "unavailable" | "unknown";
export type ClubSupplier = { id: string; name: string; memberOrderable: boolean; catalogueUrl?: string; replenishmentOnly?: boolean };
export type SupplierCatalogueVariant = { supplierId: string; parentKey: string; flavour?: string; size?: string; packQuantity?: number; supplierSku?: string; barcode?: string; stockStatus: SupplierStockStatus; availabilityCheckedAt?: string; memberOrderableUnit?: string };
export type SupplierCatalogueProduct = { parentKey: string; supplierId: string; brand?: string; name: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; variants: SupplierCatalogueVariant[] };
export type SupplierCatalogueImportRow = Omit<SupplierCatalogueVariant, "supplierId" | "parentKey"> & { supplier: string; name: string; brand?: string; description?: string; category?: string; subcategory?: string; sourceUrl?: string; imageReference?: string; parentKey?: string };

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const stock = (value: unknown): SupplierStockStatus => /^(available|in stock|yes|true|1)$/i.test(String(value ?? "")) ? "available" : /^(unavailable|out of stock|no|false|0)$/i.test(String(value ?? "")) ? "unavailable" : "unknown";
/** Removes source promotion boilerplate while retaining the real product identity. */
export function cleanSupplierProductName(value: string) { return value.replace(/\b(?:SPECIAL OFFER|FREE (?:SHAKER|PRODUCT)|EXTRA\s*\d*%?)\b/gi, "").replace(/[|–—-]\s*$/g, "").replace(/\s{2,}/g, " ").trim(); }
export function parseSupplierCatalogueRows(input: string, supplier: ClubSupplier): SupplierCatalogueImportRow[] {
  return parseCsvRecords(input).flatMap(record => { const row = record as unknown as Record<string, string>; const name = cleanSupplierProductName(clean(row.name ?? row.product ?? row.product_name) ?? ""); if (!name) return []; const sku = clean(row.supplier_sku ?? row.sku ?? row.supplier_product_code); const barcode = clean(row.barcode ?? row.ean ?? row.upc); const parsedPack = Number(row.pack_quantity ?? row.case_quantity ?? ""); return [{ supplier: supplier.id, parentKey: clean(row.parent_key) ?? name.toLowerCase(), name, ...(clean(row.brand) ? { brand: clean(row.brand) } : {}), ...(clean(row.description) ? { description: clean(row.description) } : {}), ...(clean(row.category) ? { category: clean(row.category) } : {}), ...(clean(row.subcategory) ? { subcategory: clean(row.subcategory) } : {}), ...(clean(row.source_url ?? row.product_url) ? { sourceUrl: clean(row.source_url ?? row.product_url) } : {}), ...(clean(row.image_reference ?? row.image_url) ? { imageReference: clean(row.image_reference ?? row.image_url) } : {}), ...(clean(row.variant ?? row.flavour) ? { flavour: clean(row.variant ?? row.flavour) } : {}), ...(clean(row.size) ? { size: clean(row.size) } : {}), ...(Number.isInteger(parsedPack) && parsedPack > 0 ? { packQuantity: parsedPack } : {}), ...(sku ? { supplierSku: sku } : {}), ...(barcode ? { barcode } : {}), stockStatus: stock(row.availability ?? row.stock), ...(clean(row.availability_checked_at ?? row.last_checked_at) ? { availabilityCheckedAt: clean(row.availability_checked_at ?? row.last_checked_at) } : {}), ...(clean(row.order_unit ?? row.member_orderable_unit) ? { memberOrderableUnit: clean(row.order_unit ?? row.member_orderable_unit) } : {}) } satisfies SupplierCatalogueImportRow]; });
}
export function groupSupplierCatalogue(rows: SupplierCatalogueImportRow[], supplier: ClubSupplier): SupplierCatalogueProduct[] {
  const grouped = new Map<string, SupplierCatalogueProduct>();
  for (const row of rows.filter(item => item.supplier === supplier.id)) { const existing = grouped.get(row.parentKey ?? row.name.toLowerCase()) ?? { parentKey: row.parentKey ?? row.name.toLowerCase(), supplierId: supplier.id, ...(row.brand ? { brand: row.brand } : {}), name: row.name, ...(row.description ? { description: row.description } : {}), ...(row.category ? { category: row.category } : {}), ...(row.subcategory ? { subcategory: row.subcategory } : {}), ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), ...(row.imageReference ? { imageReference: row.imageReference } : {}), variants: [] }; existing.variants.push({ supplierId: supplier.id, parentKey: existing.parentKey, flavour: row.flavour, size: row.size, packQuantity: row.packQuantity, supplierSku: row.supplierSku, barcode: row.barcode, stockStatus: row.stockStatus, availabilityCheckedAt: row.availabilityCheckedAt, memberOrderableUnit: row.memberOrderableUnit }); grouped.set(existing.parentKey, existing); }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The member resolver should receive this boolean; unknown supplier stock is never orderable. */
export function supplierVariantOrderable(supplier: ClubSupplier, variant: SupplierCatalogueVariant) {
  return supplier.memberOrderable && variant.stockStatus === "available";
}

/** Return only real variants for a selected size; never cross-product flavours. */
export function variantsForSize(product: SupplierCatalogueProduct, size?: string) {
  return product.variants.filter(variant => !size || variant.size === size);
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

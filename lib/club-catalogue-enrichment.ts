import { parseCsvRecords } from "./club-csv";
export type NutritionFacts = { basis?: string; energyKcal?: number; proteinG?: number; carbohydrateG?: number; sugarsG?: number; fatG?: number; saturatesG?: number; fibreG?: number; saltG?: number; servingSize?: string; servings?: number };
export type CatalogueEnrichmentRow = { variantId?: string; supplier: string; supplierSku?: string; barcode?: string; brand?: string; parentProduct: string; size?: string; flavour?: string; description?: string; parentImageUrl?: string; variantImageUrl?: string; nutrition?: NutritionFacts; ingredients?: string; allergens?: string; sourceUrl?: string; sourceType?: string; verifiedAt?: string };
export type EnrichmentIdentity = { id: string; supplier: string; supplierSku?: string; barcode?: string; brand?: string; parentProduct: string; size?: string; flavour?: string };
export function parseCatalogueEnrichmentCsv(input: string) {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ""));
  const errors: Array<{ row: number; reason: string }> = [];
  const result: CatalogueEnrichmentRow[] = [];
  records.forEach((value, index) => {
    const source = value as Record<string, string>;
    const row = index + 2;
    const normalised = Object.fromEntries(Object.entries(source).map(([key, val]) => [key.trim().replace(/^\uFEFF/, "").toLowerCase().replace(/\s+/g, " "), val]));
    const get = (key: string) => normalised[key.toLowerCase()] ?? "";
    const supplier = get("supplier").trim();
    const parent = get("parent product").trim();
    if (!supplier || !parent) { errors.push({ row, reason: "Supplier and Parent Product are required" }); return; }
    const verified = get("verified at").trim();
    if (verified && Number.isNaN(Date.parse(verified))) { errors.push({ row, reason: "Verified At must be a valid date/time" }); return; }
    const sourceUrl = get("source url").trim();
    if (sourceUrl) { try { if (!/^https?:$/.test(new URL(sourceUrl).protocol)) throw new Error("protocol"); } catch { errors.push({ row, reason: "Source URL must be an http(s) URL" }); return; } }
    let numericError = false;
    const number = (key: string) => { const raw = get(key).trim(); if (!raw) return undefined; const n = Number(raw); if (!Number.isFinite(n) || n < 0) { numericError = true; return undefined; } return n; };
    const nutrition: NutritionFacts = { basis: get("nutrition basis").trim() || undefined, energyKcal: number("energy kcal"), proteinG: number("protein g"), carbohydrateG: number("carbohydrate g"), sugarsG: number("sugars g"), fatG: number("fat g"), saturatesG: number("saturates g"), fibreG: number("fibre g"), saltG: number("salt g"), servingSize: get("serving size").trim() || undefined, servings: number("servings") };
    if (numericError) { errors.push({ row, reason: "Nutrition values must be non-negative numbers" }); return; }
    result.push({ variantId: get("exact variant id").trim() || undefined, supplier, supplierSku: get("supplier sku").trim() || undefined, barcode: get("barcode").trim() || undefined, brand: get("brand").trim() || undefined, parentProduct: parent, size: get("size / format").trim() || undefined, flavour: get("variant / flavour").trim() || undefined, description: get("description").trim() || undefined, parentImageUrl: get("parent image url").trim() || undefined, variantImageUrl: get("variant image url").trim() || undefined, nutrition, ingredients: get("ingredients").trim() || undefined, allergens: get("allergens").trim() || undefined, sourceUrl: sourceUrl || undefined, sourceType: get("source type").trim() || undefined, verifiedAt: verified || undefined });
  });
  return { rows: result, errors };
}

/** Resolve an enrichment row to one existing durable variant. This is deliberately
 * read-only: unmatched or ambiguous rows are errors and never create catalogue data. */
export function resolveEnrichmentIdentity(row: CatalogueEnrichmentRow, variants: EnrichmentIdentity[]) {
  if (row.variantId) {
    const exact = variants.filter((v) => v.id === row.variantId);
    return exact.length === 1 ? { variant: exact[0] } : { error: exact.length ? "ambiguous variant id" : "variant not found" };
  }
  const supplier = row.supplier.trim().toLowerCase();
  const byRef = row.supplierSku ? variants.filter((v) => v.supplier.toLowerCase() === supplier && v.supplierSku === row.supplierSku) : [];
  if (row.supplierSku) return byRef.length === 1 ? { variant: byRef[0] } : { error: byRef.length ? "ambiguous supplier SKU" : "variant not found" };
  const byBarcode = row.barcode ? variants.filter((v) => v.supplier.toLowerCase() === supplier && v.barcode === row.barcode) : [];
  if (row.barcode) return byBarcode.length === 1 ? { variant: byBarcode[0] } : { error: byBarcode.length ? "ambiguous barcode" : "variant not found" };
  const norm = (v?: string) => (v ?? "").trim().toLowerCase();
  const fallback = variants.filter((v) => v.supplier.toLowerCase() === supplier && norm(v.brand) === norm(row.brand) && norm(v.parentProduct) === norm(row.parentProduct) && norm(v.size) === norm(row.size) && norm(v.flavour) === norm(row.flavour));
  return fallback.length === 1 ? { variant: fallback[0] } : { error: fallback.length ? "ambiguous catalogue identity" : "variant not found" };
}

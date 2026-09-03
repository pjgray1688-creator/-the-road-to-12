export type BarcodeProductCandidate = { barcode: string; name?: string; brand?: string; quantity?: string; category?: string; imageUrl?: string; provider: "open_food_facts"; confidence: "low" | "medium" | "high" };
export interface BarcodeLookupProvider { lookup(barcode: string): Promise<BarcodeProductCandidate | undefined>; }

export class OpenFoodFactsBarcodeProvider implements BarcodeLookupProvider {
  async lookup(barcode: string) {
    const normalized = normalizeBarcode(barcode); if (!normalized) return undefined;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 4500);
    try { const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}.json?fields=code,product_name,brands,quantity,categories,image_front_url,generic_name`, { headers: { "User-Agent": "R12Club/1.0 (barcode lookup)" }, signal: controller.signal, cache: "no-store" }); if (!response.ok) return undefined; const data = await response.json() as { status?: number; product?: Record<string, unknown> }; if (data.status !== 1 || !data.product) return undefined; const product = data.product; const name = typeof product.product_name === "string" ? product.product_name.trim() : undefined; const brand = typeof product.brands === "string" ? product.brands.split(",")[0]?.trim() : undefined; const quantity = typeof product.quantity === "string" ? product.quantity.trim() : undefined; const category = typeof product.categories === "string" ? product.categories.split(",")[0]?.trim() : undefined; const imageUrl = typeof product.image_front_url === "string" ? product.image_front_url : undefined; return { barcode: normalized, ...(name ? { name } : {}), ...(brand ? { brand } : {}), ...(quantity ? { quantity } : {}), ...(category ? { category } : {}), ...(imageUrl ? { imageUrl } : {}), provider: "open_food_facts", confidence: name ? "medium" : "low" } satisfies BarcodeProductCandidate;
    } catch { return undefined; } finally { clearTimeout(timeout); }
  }
}

export function normalizeBarcode(value: string) { const normalized = value.trim(); return /^\d{8,14}$/.test(normalized) ? normalized : undefined; }

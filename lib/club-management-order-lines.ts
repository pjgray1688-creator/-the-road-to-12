export type ManagementOrderLineInput =
  | { kind: "catalogue"; productId: string; quantity: number }
  | { kind: "manual_service" | "manual_physical"; description: string; quantity: number; unitPriceMinor: number; notes?: string; stockProductId?: string };

export type ManagementOrderLineValidation =
  | { ok: true; needsManualPricing: boolean; lines: ManagementOrderLineInput[] }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MINOR = 2_147_483_647;

export function validateManagementOrderLines(value: unknown): ManagementOrderLineValidation {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    return { ok: false, error: "Add between 1 and 50 order lines." };
  }
  let manualTotal = 0;
  let needsManualPricing = false;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return { ok: false, error: "An order line is invalid." };
    const line = candidate as Record<string, unknown>;
    const quantity = line.quantity;
    if (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 50) {
      return { ok: false, error: "Order quantities must be whole numbers from 1 to 50." };
    }
    if (line.kind === "catalogue") {
      if (typeof line.productId !== "string" || !UUID.test(line.productId)) return { ok: false, error: "Choose a valid catalogue item." };
      continue;
    }
    if (line.kind !== "manual_service" && line.kind !== "manual_physical") return { ok: false, error: "An order line type is unsupported." };
    needsManualPricing = true;
    if (typeof line.description !== "string" || line.description.trim().length < 2 || line.description.trim().length > 160) return { ok: false, error: "Manual line descriptions must contain 2 to 160 characters." };
    if (!Number.isSafeInteger(line.unitPriceMinor) || Number(line.unitPriceMinor) < 0 || Number(line.unitPriceMinor) > MAX_MINOR || Number(line.unitPriceMinor) * Number(quantity) > MAX_MINOR) return { ok: false, error: "Manual prices must be non-negative whole GBP minor units within the supported limit." };
    if (line.notes !== undefined && line.notes !== null && (typeof line.notes !== "string" || line.notes.length > 500)) return { ok: false, error: "Manual line notes cannot exceed 500 characters." };
    if (line.stockProductId !== undefined && line.stockProductId !== null) {
      if (line.kind !== "manual_physical" || typeof line.stockProductId !== "string" || !UUID.test(line.stockProductId)) return { ok: false, error: "Only a manual physical line can link a valid stock item." };
    }
    manualTotal += Number(line.unitPriceMinor) * Number(quantity);
    if (!Number.isSafeInteger(manualTotal) || manualTotal > MAX_MINOR) return { ok: false, error: "Manual line totals exceed the supported order limit." };
  }
  if (manualTotal >= MAX_MINOR) return { ok: false, error: "Order total exceeds the supported limit." };
  return { ok: true, needsManualPricing, lines: value as ManagementOrderLineInput[] };
}

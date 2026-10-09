export type RefundableLine = {
  orderItemId: string;
  productName: string;
  kind: "retail" | "service";
  quantity: number;
  lineTotalMinor: number;
  saleValueMinor: number;
  refundedQuantity: number;
  refundedMinor: number;
  refundableQuantity: number;
  refundableMinor: number;
  unit: string;
  originalUnits: number;
  availableUnits?: number;
};

/** Display-only estimate. The database recomputes every amount from the sale snapshot. */
export function refundLineAmount(line: RefundableLine, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > line.refundableQuantity) return 0;
  if (line.kind === "retail") {
    const before = BigInt(line.saleValueMinor) * BigInt(line.refundedQuantity) / BigInt(line.quantity);
    const after = BigInt(line.saleValueMinor) * BigInt(line.refundedQuantity + quantity) / BigInt(line.quantity);
    return Number(after - before);
  }
  const remaining = BigInt(line.availableUnits ?? line.refundableQuantity);
  const units = BigInt(quantity);
  const total = BigInt(line.saleValueMinor);
  const original = BigInt(line.originalUnits);
  return Number(total * remaining / original - total * (remaining - units) / original);
}

export function refundSelectionTotal(lines: RefundableLine[], selection: Record<string, number>): number {
  return lines.reduce((sum, line) => sum + refundLineAmount(line, selection[line.orderItemId] ?? 0), 0);
}

export type SettlementLine = {
  orderItemId: string;
  quantity: number;
  stockTracked?: boolean;
  supplierOrderForCollection?: boolean;
  serviceId?: string | null;
};

export type SettlementEffect = {
  key: string;
  kind: "stock_sale" | "supplier_demand" | "service_entitlement";
  orderItemId: string;
  quantity: number;
};

/** Deterministic policy shared by every successful tender boundary. Database
 * functions remain authoritative for applying these effects transactionally. */
export function settlementEffects(lines: SettlementLine[], alreadyApplied = new Set<string>()): SettlementEffect[] {
  const effects: SettlementEffect[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    const add = (kind: SettlementEffect["kind"]) => {
      const key = `${kind}:${line.orderItemId}`;
      if (!alreadyApplied.has(key)) effects.push({ key, kind, orderItemId: line.orderItemId, quantity: line.quantity });
    };
    if (line.stockTracked) add("stock_sale");
    if (line.supplierOrderForCollection) add("supplier_demand");
    if (line.serviceId) add("service_entitlement");
  }
  return effects;
}

export function settlementEffectsForOutcome(outcome: "paid" | "failed" | "cancelled", lines: SettlementLine[]) {
  return outcome === "paid" ? settlementEffects(lines) : [];
}

export type ServiceRefundAllowance = { eligible: boolean; refundableMinor: number; remainingUnits: number; reason?: string };

/** Display-only estimate from the persisted order-line and credit-lot snapshot.
 * The database repeats every check and remains authoritative at refund time. */
export function serviceRefundAllowance(lineTotalMinor: number, originalUnits: number, remainingUnits: number): ServiceRefundAllowance {
  if (![lineTotalMinor, originalUnits, remainingUnits].every(Number.isSafeInteger) || lineTotalMinor <= 0 || originalUnits <= 0 || remainingUnits < 0 || remainingUnits > originalUnits) {
    return { eligible: false, refundableMinor: 0, remainingUnits: 0, reason: "No safely linked unused credits were found for this purchase." };
  }
  const refundableMinor = Number(BigInt(lineTotalMinor) * BigInt(remainingUnits) / BigInt(originalUnits));
  return refundableMinor > 0
    ? { eligible: true, refundableMinor, remainingUnits }
    : { eligible: false, refundableMinor: 0, remainingUnits, reason: "No unused service units remain to refund." };
}

export function serviceUnitsForRefund(lineTotalMinor: number, originalUnits: number, remainingUnits: number, amountMinor: number): number | undefined {
  const allowance = serviceRefundAllowance(lineTotalMinor, originalUnits, remainingUnits);
  if (!allowance.eligible || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > allowance.refundableMinor) return undefined;
  const total = BigInt(lineTotalMinor);
  const original = BigInt(originalUnits);
  const remaining = BigInt(remainingUnits);
  let matched: number | undefined;
  for (let units = 1; units <= remainingUnits; units += 1) {
    const tailValue = total * remaining / original - total * (remaining - BigInt(units)) / original;
    // When one minor unit covers several low-value credits, reverse the most
    // units represented by the amount; this cannot leave paid-for units behind.
    if (tailValue === BigInt(amountMinor)) matched = units;
  }
  return matched;
}

export function calculateTillVarianceMinor(countedCashMinor: number, expectedCashMinor: number): number | undefined {
  if (!Number.isSafeInteger(countedCashMinor) || countedCashMinor < 0 || !Number.isSafeInteger(expectedCashMinor)) return undefined;
  return countedCashMinor - expectedCashMinor;
}

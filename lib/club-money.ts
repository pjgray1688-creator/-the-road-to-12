/** Parse a UK decimal currency amount into integer minor units without float arithmetic. */
export function parseMinorUnits(value: string): number | undefined {
  const input = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return undefined;
  const [whole, fraction = ""] = input.split(".");
  const major = Number(whole);
  const minor = Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return undefined;
  const result = major * 100 + minor;
  return Number.isSafeInteger(result) ? result : undefined;
}

export function cashDiscrepancyMinor(declaredMinor: number, countedPounds: string): number | undefined {
  const countedMinor = parseMinorUnits(countedPounds);
  return countedMinor === undefined ? undefined : countedMinor - declaredMinor;
}

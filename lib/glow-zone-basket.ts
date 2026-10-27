export const GLOW_PAYG_PRICE_MINOR = 100;
export const GLOW_PAYG_MAX_MINUTES = 240;

export function normaliseGlowPaygMinutes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(GLOW_PAYG_MAX_MINUTES, Math.max(1, Math.trunc(parsed)));
}

export function glowBasketTotal(lines: Array<{ quantity: number; priceMinor: number }>) {
  return lines.reduce((total, line) => total + line.quantity * line.priceMinor, 0);
}

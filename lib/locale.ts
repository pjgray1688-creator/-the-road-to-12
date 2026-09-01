export type BodyUnitPreference = { weight: "kg" | "lb"; circumference: "cm" | "in" };
export function defaultBodyUnits(locale = typeof navigator !== "undefined" ? navigator.language : "en-GB"): BodyUnitPreference { return /^(en-US|en-CA|en-LR|my)/i.test(locale) ? { weight: "lb", circumference: "in" } : { weight: "kg", circumference: "cm" }; }
export function formatDisplayDate(value: string, locale = typeof navigator !== "undefined" ? navigator.language : "en-GB") { const date = new Date(`${value}T12:00:00`); if (Number.isNaN(date.getTime())) return value; return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date); }
export function formatNumber(value: number, locale = typeof navigator !== "undefined" ? navigator.language : "en-GB", maximumFractionDigits = 1) { return new Intl.NumberFormat(locale, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value); }
export function kgToLb(value: number) { return value * 2.2046226218; }
export function lbToKg(value: number) { return value / 2.2046226218; }
export function cmToIn(value: number) { return value / 2.54; }
export function inToCm(value: number) { return value * 2.54; }
export function displayWeight(kg: number, unit: BodyUnitPreference["weight"], locale?: string) { return `${formatNumber(unit === "lb" ? kgToLb(kg) : kg, locale)} ${unit}`; }
export function displayCircumference(cm: number, unit: BodyUnitPreference["circumference"], locale?: string) { return `${formatNumber(unit === "in" ? cmToIn(cm) : cm, locale)} ${unit}`; }

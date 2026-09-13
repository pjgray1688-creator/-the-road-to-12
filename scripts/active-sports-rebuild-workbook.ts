#!/usr/bin/env tsx
/** Deterministically rebuilds a review package from local Active Sports CSV evidence. */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCsvRecords } from "../lib/club-csv";

type RecordRow = Record<string, string>;
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value: unknown) => clean(value).toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
const esc = (value: unknown) => { const text = clean(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
const get = (row: RecordRow, ...names: string[]) => { for (const name of names) { const value = row[name.toLocaleLowerCase()]; if (value) return clean(value); } return ""; };
const money = (value: string) => { const match = clean(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return match ? Number(match[0]) : undefined; };
const formatKey = (row: RecordRow) => [get(row, "brand"), get(row, "parent product", "product", "product name"), get(row, "size / format", "size"), get(row, "pack qty", "pack quantity", "order unit")].map(norm).join("|");
const displayProduct = (row: RecordRow) => get(row, "parent product", "product", "product name");
const displaySize = (row: RecordRow) => get(row, "size / format", "size");
const displayFlavour = (row: RecordRow) => get(row, "variant / flavour", "variant", "flavour", "flavor");
const imageUrl = (row: RecordRow, ...names: string[]) => get(row, ...names).match(/^https?:\/\//i)?.[0] ?? "";
const aliases = {
  supplier: ["supplier"], brand: ["brand"], product: ["parent product", "product", "product name"], size: ["size / format", "size"], flavour: ["variant / flavour", "variant", "flavour", "flavor"],
  parentImage: ["parent image url"], variantImage: ["variant image url"], imageStatus: ["image status"], sourceUrl: ["source url"], cost: ["trade cost ex vat", "trade cost", "cost ex vat", "trade price"], vat: ["vat rate", "supplied vat rate", "vat"], sell: ["live selling price", "selling price", "retail price", "sell price", "current sell price"], sku: ["supplier sku", "sku"], barcode: ["barcode"], stock: ["supplier stock", "stock"], notes: ["notes"]
} as const;
const value = (row: RecordRow, field: keyof typeof aliases) => get(row, ...aliases[field]);

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function readRecords(path: string) { return parseCsvRecords(await readFile(path, "utf8"), false) as RecordRow[]; }
function csv(rows: RecordRow[], headers: string[]) { return [headers.join(","), ...rows.map(row => headers.map(header => esc(row[header])).join(","))].join("\n") + "\n"; }
function rowKey(row: RecordRow) { return `${norm(value(row, "brand"))}|${norm(value(row, "product"))}|${norm(value(row, "size"))}|${norm(value(row, "flavour"))}`; }
function sourceMatch(row: RecordRow, enriched: RecordRow[]) {
  const key = rowKey(row); const format = formatKey(row);
  return enriched.find(candidate => rowKey(candidate) === key) ?? enriched.find(candidate => formatKey(candidate) === format && norm(value(candidate, "brand")) === norm(value(row, "brand")));
}
function issue(base: RecordRow, type: string, severity: string, action: string, evidence: string, safety: string): RecordRow { return { brand: value(base, "brand"), product: displayProduct(base), "size/format": displaySize(base), flavour: displayFlavour(base), "issue type": type, severity, "recommended action": action, "evidence source": evidence, "import safety": safety }; }

async function main() {
  const input = resolve(process.argv[2] ?? `${process.env.HOME ?? "."}/Downloads/active-sports-final-fixed.csv`);
  const enrichmentDir = resolve(process.argv[3] ?? `${process.env.HOME ?? "."}/Desktop/active-sports-enriched-full`);
  const outputDir = resolve(process.argv[4] ?? `${process.env.HOME ?? "."}/Desktop/active-sports-workbook-rebuild`);
  console.log(`Input CSV: ${input}`); console.log(`Enrichment directory: ${enrichmentDir}`); console.log(`Output directory: ${outputDir}`);
  if (!(await exists(input))) throw new Error(`Input CSV does not exist: ${input}`);
  if (!(await exists(enrichmentDir))) throw new Error(`Enrichment directory does not exist: ${enrichmentDir}`);
  await mkdir(outputDir, { recursive: true });
  const original = await readRecords(input);
  const enrichedPath = resolve(enrichmentDir, "enriched.csv");
  const enriched = await exists(enrichedPath) ? await readRecords(enrichedPath) : [];
  const rebuilt: RecordRow[] = []; const corrections: RecordRow[] = []; const missing: RecordRow[] = []; const stale: RecordRow[] = []; const lowTicket: RecordRow[] = []; const imageAudit: RecordRow[] = [];
  let imagesCopied = 0; let missingImages = 0;
  for (const row of original) {
    const match = sourceMatch(row, enriched); const beforeParent = value(row, "parentImage"); const beforeVariant = value(row, "variantImage"); const afterParent = beforeParent || (match ? imageUrl(match, ...aliases.parentImage) : ""); const afterVariant = beforeVariant || (match ? imageUrl(match, ...aliases.variantImage) : "");
    if (!beforeParent && afterParent) imagesCopied += 1;
    const status = afterParent || afterVariant ? "Source image found" : "Missing image URL"; if (!afterParent && !afterVariant) missingImages += 1;
    const next: RecordRow = { ...row, "parent image url": afterParent, "variant image url": afterVariant, "image status": status };
    rebuilt.push(next);
    imageAudit.push({ brand: value(row, "brand"), "parent product": displayProduct(row), "size/format": displaySize(row), flavour: displayFlavour(row), "existing image status": value(row, "imageStatus"), "parent image url before": beforeParent, "parent image url after": afterParent, "variant image url": afterVariant, "action taken": afterParent && !beforeParent ? "Copied matched parent image" : afterVariant && !beforeVariant ? "Preserved matched variant image" : afterParent || afterVariant ? "Preserved existing image" : "Manual image check required" });
    if (!afterParent && !afterVariant) corrections.push(issue(row, "Missing image URL", "warning", "Supply or verify a supplier image URL", "Original and enrichment CSV", "Verify before adding"));
    if (value(row, "imageStatus") && /verified|ready|complete|uploaded/i.test(value(row, "imageStatus")) && !afterParent && !afterVariant) corrections.push(issue(row, "Bad image status", "high", "Replace status after image evidence exists", "Original image status contradicts blank URLs", "Verify before adding"));
    if (!value(row, "cost")) corrections.push(issue(row, "Missing price evidence", "high", "Confirm supplier trade cost and VAT", "Original CSV", "Verify before adding"));
    const sell = money(value(row, "sell")); if (sell !== undefined && sell < 2) { lowTicket.push({ brand: value(row, "brand"), "product name": displayProduct(row), "size/format": displaySize(row), flavour: displayFlavour(row), supplier: value(row, "supplier"), "trade cost": value(row, "cost"), "VAT status": value(row, "vat"), "current sell price": value(row, "sell"), margin: "", reason: "Manual review required" }); corrections.push(issue(row, "Low-ticket pricing review", "medium", "Review selling price without automatic change", "Current/generated selling price below £2", "Verify before adding")); }
    if (/special offer|bbe|best before|pallet|promo/i.test(`${displayProduct(row)} ${value(row, "notes")}`)) corrections.push(issue(row, "Special offer/BBE preservation", "medium", "Keep separate from the normal product family", "Product or notes text", "Verify before adding"));
    if (/single|sachet|rtd|can|shot|gel|bar|caps|tablet|tub|case|box/i.test(displaySize(row))) corrections.push(issue(row, "Grouping risk", "low", "Review exact format/pack grouping", "Size/format discriminator", "Import-safe evidence"));
  }
  const originalKeys = new Set(original.map(row => rowKey(row))); const knownMissing = [
    ["Applied Nutrition", "Beef-XP Clear Hydrolysed Beef Protein Isolate", "900g", "Missing from original workbook; separate from sachet and 1.8kg."],
    ["10X Athletic", "GLUT+ - Micronised L-Glutamine - 300g - SPECIAL OFFER", "300g", "Special-offer/current stock evidence required."],
    ["Scivation", "Xtend", "30 Servings", "Crawler source requires current orderability evidence."],
    ["Scivation", "Xtend BCAA", "90 Servings", "Crawler source requires current orderability evidence."]
  ];
  for (const [brand, product, size, note] of knownMissing) { const probe = { brand, "parent product": product, "size/format": size }; if (!originalKeys.has(rowKey(probe)) && !enriched.some(row => rowKey(row) === rowKey(probe))) { missing.push({ brand, "parent product": product, "size/format": size, "reason": note, "price evidence": "", "stock evidence": "", "import safety": "Verify before adding" }); corrections.push(issue(probe, "Missing product from workbook", "high", "Review current source evidence before adding", note, "Verify before adding")); } }
  for (const row of enriched) { if (/optimum nutrition/i.test(value(row, "brand")) && !originalKeys.has(rowKey(row))) stale.push({ brand: value(row, "brand"), product: displayProduct(row), "size/format": displaySize(row), reason: "Not present in original workbook; do not bulk-add stale/indexed ON products", evidence: value(row, "sourceUrl"), "import safety": "Stale/source-unproven" }); }
  const brands = [...new Set(rebuilt.map(row => value(row, "brand")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const brandSummary = brands.map(brand => { const rows = rebuilt.filter(row => value(row, "brand") === brand); const brandIssues = corrections.filter(row => row.brand === brand); return { brand, "total rows": String(rows.length), "parent product count": String(new Set(rows.map(row => `${displayProduct(row)}|${displaySize(row)}`)).size), "rows with parent image url": String(rows.filter(row => value(row, "parentImage")).length), "rows missing image url": String(rows.filter(row => !value(row, "parentImage") && !value(row, "variantImage")).length), "rows flagged corrections": String(brandIssues.length), "rows low-ticket review": String(lowTicket.filter(row => row.brand === brand).length), notes: "Missing media is a warning and does not by itself block import." }; });
  const baseHeaders = [...new Set([...Object.keys(original[0] ?? {}), "parent image url", "variant image url", "image status"])];
  await writeFile(resolve(outputDir, "active-sports-rebuilt.csv"), csv(rebuilt, baseHeaders));
  await writeFile(resolve(outputDir, "active-sports-corrections-needed.csv"), csv(corrections, ["brand", "product", "size/format", "flavour", "issue type", "severity", "recommended action", "evidence source", "import safety"]));
  await writeFile(resolve(outputDir, "active-sports-missing-products-to-review.csv"), csv(missing, ["brand", "parent product", "size/format", "reason", "price evidence", "stock evidence", "import safety"]));
  await writeFile(resolve(outputDir, "active-sports-stale-or-unproven-products.csv"), csv(stale, ["brand", "product", "size/format", "reason", "evidence", "import safety"]));
  await writeFile(resolve(outputDir, "active-sports-low-ticket-pricing-review.csv"), csv(lowTicket, ["brand", "product name", "size/format", "flavour", "supplier", "trade cost", "VAT status", "current sell price", "margin", "reason"]));
  await writeFile(resolve(outputDir, "active-sports-image-audit.csv"), csv(imageAudit, ["brand", "parent product", "size/format", "flavour", "existing image status", "parent image url before", "parent image url after", "variant image url", "action taken"]));
  await writeFile(resolve(outputDir, "active-sports-brand-summary.csv"), csv(brandSummary, ["brand", "total rows", "parent product count", "rows with parent image url", "rows missing image url", "rows flagged corrections", "rows low-ticket review", "notes"]));
  const summary = { inputRowCount: original.length, outputRowCount: rebuilt.length, imagesCopiedIntoRebuiltCsv: imagesCopied, rowsStillMissingImageUrl: missingImages, correctionsNeededCount: corrections.length, missingProductsToReviewCount: missing.length, staleOrUnprovenCount: stale.length, lowTicketReviewCount: lowTicket.length, outputFolder: outputDir, enrichmentRowsRead: enriched.length };
  await writeFile(resolve(outputDir, "active-sports-audit-summary.json"), JSON.stringify(summary, null, 2) + "\n"); console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

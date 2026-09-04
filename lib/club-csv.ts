export type ClubImportRow = { name: string; category?: string; price: string; barcode?: string; sku?: string; stockTracked: boolean; active: boolean; notes?: string; status?: string; reason?: string };

export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < input.length; i += 1) { const ch = input[i]; if (quoted) { if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch; } else if (ch === '"') quoted = true; else if (ch === ",") { row.push(field); field = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && input[i + 1] === "\n") i += 1; row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ""; } else field += ch; }
  if (field || row.length) { row.push(field); if (row.some(value => value.trim())) rows.push(row); }
  if (!rows.length) return []; const headers = rows.shift()!.map(value => value.trim().toLowerCase());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

export function parseClubCsv(input: string): ClubImportRow[] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < input.length; i += 1) { const ch = input[i]; if (quoted) { if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch; } else if (ch === '"') quoted = true; else if (ch === ",") { row.push(field); field = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && input[i + 1] === "\n") i += 1; row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ""; } else field += ch; }
  if (field || row.length) { row.push(field); if (row.some(value => value.trim())) rows.push(row); }
  if (!rows.length) return []; const headers = rows.shift()!.map(value => value.trim().toLowerCase());
  return rows.map(values => { const get = (key: string) => values[headers.indexOf(key)]?.trim() ?? ""; const name = get("name"); const price = get("price"); const notes = get("notes"); const barcode = get("barcode"); const sku = get("sku"); const stockTracked = get("stocktracked").toLowerCase() === "true"; const active = get("active").toLowerCase() !== "false"; const review = name.toLowerCase() === "collagen" ? "2 for £20 is known; single-item price requires review" : undefined; const status = review ? "REVIEW REQUIRED" : !name || !price ? "INVALID" : "NEW"; return { name, category: get("category") || undefined, price, barcode: barcode || undefined, sku: sku || undefined, stockTracked, active, notes: notes || undefined, status, reason: !name ? "Product name is required" : review ?? (!price ? "Selling price is required" : undefined) }; });
}

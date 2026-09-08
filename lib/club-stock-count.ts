import { parseCsvRecords } from "./club-csv";
export type StockCountRow = { variantId:string; countedQuantity:number };
export type StockCountAdjustment = StockCountRow & { currentOnHand:number; quantityDelta:number };
export function parseStockCountCsv(input:string){const records=parseCsvRecords(input.replace(/^\uFEFF/,""));const errors:Array<{row:number;reason:string}>=[];const rows:StockCountRow[]=[];records.forEach((value,index)=>{const r=Object.fromEntries(Object.entries(value as Record<string,string>).map(([k,v])=>[k.trim().toLowerCase(),v]));const row=index+2;const id=(r["exact variant id"]??r.variant_id??"").trim();const raw=(r["counted qty"]??r.counted_quantity??"").trim();if(!id){errors.push({row,reason:"Exact Variant ID is required"});return;}if(!raw)return;const n=Number(raw);if(!Number.isInteger(n)||n<0)errors.push({row,reason:"Counted Qty must be a non-negative whole number"});else rows.push({variantId:id,countedQuantity:n});});return {rows,errors};}
export function stockCountAdjustment(currentOnHand:number,countedQuantity:number){if(!Number.isInteger(currentOnHand)||!Number.isInteger(countedQuantity)||countedQuantity<0)throw new Error("invalid_stock_count");return countedQuantity-currentOnHand;}
/** Build a preview only; callers must explicitly confirm before passing deltas to
 * the existing inventory adjustment RPC. Missing variants are surfaced rather
 * than creating catalogue or inventory records. */
export function previewStockCount(rows: StockCountRow[], currentOnHand: Map<string, number>) {
  const errors: Array<{ variantId: string; reason: string }> = [];
  const adjustments: StockCountAdjustment[] = [];
  for (const row of rows) {
    const current = currentOnHand.get(row.variantId);
    if (current === undefined) { errors.push({ variantId: row.variantId, reason: "Exact variant not found" }); continue; }
    const quantityDelta = stockCountAdjustment(current, row.countedQuantity);
    if (quantityDelta !== 0) adjustments.push({ ...row, currentOnHand: current, quantityDelta });
  }
  return { adjustments, errors };
}

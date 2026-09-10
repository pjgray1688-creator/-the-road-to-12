import { readFile, writeFile } from "node:fs/promises";
import { normalizeActiveSportsCsv, activeSportsReconciliationReport } from "../lib/club-supplier-catalogue";

const input = process.argv[2] ?? "data/active-sports/catalogue.csv";
const output = process.argv[3] ?? "data/active-sports/reconciliation-report.json";
const csv = await readFile(input, "utf8");
const result = normalizeActiveSportsCsv(csv);
const report = { generatedAt: new Date().toISOString(), input, publication: "REVIEW_ONLY_NOT_CUSTOMER_LIVE", ...activeSportsReconciliationReport(result.rows, result.errors, result.duplicateRows), errors: result.errors, duplicateRows: result.duplicateRows };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

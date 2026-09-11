import { readFile, writeFile } from "node:fs/promises";
import { prepareActiveSportsImport } from "../lib/club-supplier-catalogue";

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Supply the final reviewed CSV path explicitly.");
  const output = process.argv[3] ?? "/tmp/active-sports-report.json";
  const result = prepareActiveSportsImport(await readFile(input, "utf8"));
  const report = { input, publication: "VALIDATION_ONLY", ...result.summary, errors: result.errors, duplicateRows: result.duplicateRows, databaseComparison: "Upload this CSV in Club → Products & Pricing for authenticated proposed creates, updates, retirements, cost changes and retained manual prices." };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (result.errors.length || result.duplicateRows.length || !result.rows.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });

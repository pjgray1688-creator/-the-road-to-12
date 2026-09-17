"use client";
import { useState, useTransition } from "react";
import { parseGsnCsv } from "@/lib/gsn-catalogue";
import { importGsnCatalogueAction } from "@/app/club/shop/supplier-catalogue/actions";

export function ClubGsnImport({ organisationId }: { organisationId: string }) {
  const [preview, setPreview] = useState<ReturnType<typeof parseGsnCsv>>();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string>();
  return <section aria-label="Import GSN local catalogue"><h3>Import GSN local catalogue</h3><p className="hint">Local stock only; supplier ordering disabled. Physical stock is unchanged.</p><input type="file" accept=".csv" onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(text => { setResult(undefined); setPreview(parseGsnCsv(text)); }); }} />{preview ? <><p className="hint">Preview only · {preview.rows.length} accepted current products · {preview.errors.length} excluded/invalid rows</p>{preview.errors.length ? <ul>{preview.errors.slice(0, 10).map(error => <li key={`${error.row}-${error.reason}`}>Row {error.row}: {error.reason}</li>)}</ul> : null}<p className="hint">Supplier-orderable: no · Physical stock: unchanged · Pot O Gold: {preview.rows.filter(row => /pot o gold/i.test(row.range)).length} · Wraps: {preview.rows.filter(row => /wrap/i.test(row.range)).length} · Signature: {preview.rows.filter(row => /signature/i.test(row.range)).length}</p><button className="primary" disabled={pending || !preview.rows.length} onClick={() => startTransition(async () => { const response = await importGsnCatalogueAction({ organisationId, rows: preview.rows }); setResult(response.ok ? `Created: ${response.created}, updated: ${response.updated}, unchanged: ${response.unchanged}.` : (response.error ?? "Import failed.")); })}>Confirm GSN import</button></> : null}{result ? <p role="status">{result}</p> : null}</section>;
}

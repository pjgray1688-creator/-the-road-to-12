"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { prepareActiveSportsImport, resolveValidatedSupplierImage } from "@/lib/club-supplier-catalogue";

type ActiveSportsDiagnostic = { category: "validation" | "database" | "unexpected"; message: string; code?: string; rows?: number[]; identityKey?: string; field?: string };
function diagnostic(error: unknown, category: ActiveSportsDiagnostic["category"], code?: string): ActiveSportsDiagnostic {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown catalogue failure";
  const rows = [...message.matchAll(/(?:row|rows?)\s*#?\s*(\d+)/gi)].map(match => Number(match[1]));
  const identityKey = message.match(/identity(?: key)?\s*[=:]?\s*([^.;]+)/i)?.[1]?.trim();
  const field = message.match(/(?:field|column)\s*[=:]?\s*([A-Za-z][\w /-]*)/i)?.[1]?.trim();
  return { category, message, ...(code ? { code } : {}), ...(rows.length ? { rows: [...new Set(rows)] } : {}), ...(identityKey ? { identityKey } : {}), ...(field ? { field } : {}) };
}

export async function reconcileActiveSportsAction(input: { organisationId: string; csv: string; fileName: string; revision?: string; confirm?: boolean; duplicateChoices?: Record<string, number> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in with catalogue and pricing access." };
  const context = await resolveClubOrganisationContext(client, user.id, input.organisationId);
  if (!context || !(await context.repository.hasCapability(input.organisationId, user.id, "supplier.catalogue_manage")) || !(await context.repository.hasCapability(input.organisationId, user.id, "commerce.pricing_manage"))) return { ok: false as const, error: "Catalogue and pricing access required." };
  if (typeof input.csv !== "string" || Buffer.byteLength(input.csv, "utf8") > 8000000 || !input.csv.trim()) return { ok: false as const, error: "Choose a CSV smaller than 8 MB." };
  let parsed: ReturnType<typeof prepareActiveSportsImport>;
  try { parsed = prepareActiveSportsImport(input.csv, { duplicateChoices: input.duplicateChoices }); }
  catch (error) { const detail = diagnostic(error, "unexpected"); return { ok: false as const, error: "Unexpected validation failure. No changes were applied.", diagnostic: detail }; }
  if (parsed.errors.length || parsed.duplicateRows.length || !parsed.rows.length) return { ok: false as const, error: parsed.duplicateGroups?.some(group => !group.identical) ? "Conflicting duplicate identities require review." : "Correct the source rows before importing.", summary: parsed.summary, errors: parsed.errors, duplicateRows: parsed.duplicateRows, duplicateGroups: parsed.duplicateGroups };
  const rows = parsed.rows.map(row => ({ ...row, supplier: "Active Sports", parentImageReference: resolveValidatedSupplierImage({ supplierId: "active-sports", parentKey: row.parentKey ?? "", name: row.name, imageReference: row.parentImageReference, variants: [] }), variantImageReference: resolveValidatedSupplierImage({ supplierId: "active-sports", parentKey: row.parentKey ?? "", name: row.name, imageReference: row.variantImageReference, variants: [] }), finalRetailMinor: undefined, suggestedRetailMinor: undefined, trueCostMinor: undefined }));
  const { data, error } = await client.rpc("club_reconcile_active_sports", { p_organisation_id: input.organisationId, p_file_name: input.fileName.slice(0, 200), p_rows: rows, p_apply: input.confirm === true, p_expected_revision: input.revision ?? null });
  if (error) {
    console.error("[active-sports-reconcile]", { code: error.code, message: error.message });
    const detail = diagnostic(error.message || "Catalogue reconciliation failed", error.code === "22023" ? "validation" : "database", error.code);
    return { ok: false as const, error: error.code === "40001" ? "Catalogue changed since review. Run the comparison again." : `Catalogue reconciliation failed (${detail.category}). ${detail.message}`, diagnostic: detail, summary: parsed.summary, errors: parsed.errors, duplicateRows: parsed.duplicateRows, duplicateGroups: parsed.duplicateGroups };
  }
  if (input.confirm) for (const path of ["/club/products", "/club/shop", "/club/shop/supplier-catalogue", "/member-hub/shop"]) revalidatePath(path);
  return { ok: true as const, summary: parsed.summary, duplicateGroups: parsed.duplicateGroups, comparison: data as Record<string, number | string | boolean> };
}

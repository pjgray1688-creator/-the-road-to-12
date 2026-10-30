"use server";

import { revalidatePath } from "next/cache";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

async function authorised(organisationId: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return {};
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) return {};
  return { client, context };
}

export async function recordCashBoxCollectionAction(input: { organisationId: string; locationId: string; amountMinor: number; collectedAt: string; notes?: string }) {
  try {
    const { client, context } = await authorised(input.organisationId); if (!client || !context) return { ok: false, error: "Cash reconciliation permission is required." };
    if (!input.locationId || !Number.isInteger(input.amountMinor) || input.amountMinor < 0 || !Number.isFinite(Date.parse(input.collectedAt)) || (input.notes?.length ?? 0) > 500) return { ok: false, error: "Enter the venue, physical collection time and amount removed." };
    const { error } = await client.rpc("club_record_cash_box_collection", { p_organisation_id: context.organisation.id, p_location_id: input.locationId, p_collected_amount_minor: input.amountMinor, p_collected_at: new Date(input.collectedAt).toISOString(), p_notes: input.notes?.trim() || null });
    if (error) return { ok: false, error: error.code === "23505" ? "That venue and collection time are already recorded." : "The collection could not be recorded. No existing cash records were changed." };
    revalidatePath("/club/payments/cash-collections", "page"); return { ok: true };
  } catch { return { ok: false, error: "The collection could not be recorded." }; }
}

export async function resolveCashCollectionVarianceAction(input: { organisationId: string; collectionId: string; resolutionType: "explained" | "investigating" | "accepted_variance"; note: string }) {
  try {
    const { client, context } = await authorised(input.organisationId); if (!client || !context) return { ok: false, error: "Cash reconciliation permission is required." };
    if (input.note.trim().length < 8) return { ok: false, error: "Record a clear variance explanation." };
    const { error } = await client.rpc("club_resolve_cash_collection_variance", { p_organisation_id: context.organisation.id, p_collection_id: input.collectionId, p_resolution_type: input.resolutionType, p_note: input.note.trim() });
    if (error) return { ok: false, error: "The variance review could not be recorded." };
    revalidatePath("/club/payments/cash-collections", "page"); return { ok: true };
  } catch { return { ok: false, error: "The variance review could not be recorded." }; }
}

export async function resolveLateCashMovementAction(input: { organisationId: string; lateMovementId: string; note: string }) {
  try {
    const { client, context } = await authorised(input.organisationId); if (!client || !context) return { ok: false, error: "Cash reconciliation permission is required." };
    if (input.note.trim().length < 8) return { ok: false, error: "Record how this late entry was reviewed." };
    const { error } = await client.rpc("club_resolve_late_cash_movement", { p_organisation_id: context.organisation.id, p_late_movement_id: input.lateMovementId, p_note: input.note.trim() });
    if (error) return { ok: false, error: error.code === "23505" ? "This late entry already has a resolution." : "The late-entry review could not be recorded." };
    revalidatePath("/club/payments/cash-collections", "page"); return { ok: true };
  } catch { return { ok: false, error: "The late-entry review could not be recorded." }; }
}

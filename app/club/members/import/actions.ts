"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

async function authorised(org: string) { const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) return; const context = await resolveClubOrganisationContext(client, user.id, org); if (!context || !(await context.repository.hasCapability(org, user.id, "members.import"))) return; return { client, user }; }

const APPROVED_RECOVERY_BATCH_ID = "6bf9d303-525a-4565-88a4-b4121fac7f98";
type ImportRecoverySummary = {
  state: "eligible" | "completed" | "not_eligible";
  total: number;
  imported: number;
  linked: number;
  recovered: number;
  skipped: number | null;
  rejected: number;
  failed: number | null;
  memberships: number;
};

function summarizeRecoveryReport(value: unknown): ImportRecoverySummary | null {
  if (!value || typeof value !== "object") return null;
  const report = value as { batch?: Record<string, unknown>; rows?: unknown[] };
  const batch = report.batch;
  if (!batch || !Array.isArray(report.rows)) return null;
  const rows = report.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  const imported = rows.filter(row => row.outcome === "imported").length;
  const linked = rows.filter(row => row.outcome === "linked").length;
  const rejected = rows.filter(row => row.outcome === "rejected").length;
  const memberships = rows.filter(row => typeof row.imported_membership_id === "string").length;
  const total = rows.length;
  const skippedValue = Number(batch.skipped_count);
  const failedValue = Number(batch.failed_count);
  const skipped = batch.skipped_count != null && Number.isFinite(skippedValue) ? skippedValue : null;
  const failed = batch.failed_count != null && Number.isFinite(failedValue) ? failedValue : null;
  const complete = batch.status === "completed" && Number(batch.row_count) === 702 && total === 702
    && imported + linked === 702 && rejected === 0 && memberships === 475;
  const eligible = batch.status === "completed" && Number(batch.row_count) === 702 && total === 702
    && imported === 16 && linked === 209 && rejected === 477
    && rows.every(row => row.outcome !== "rejected" || (row.imported_membership_id == null
      && Array.isArray(row.blockers) && row.blockers.length === 1
      && row.blockers[0] === "Import failed safely; review this row"));
  return {
    state: complete ? "completed" : eligible ? "eligible" : "not_eligible",
    total,
    imported,
    linked,
    recovered: complete ? Math.max(0, imported + linked - 225) : 0,
    skipped,
    rejected,
    failed,
    memberships,
  };
}

async function readApprovedRecoverySummary(client: Awaited<ReturnType<typeof serverSupabase>>, organisationId: string) {
  const { data, error } = await client.rpc("club_list_member_import_batch", {
    p_organisation_id: organisationId,
    p_batch_id: APPROVED_RECOVERY_BATCH_ID,
  });
  if (error) return null;
  return summarizeRecoveryReport(data);
}

export async function getApprovedMemberImportRecoveryStatusAction(organisationId: string) {
  try {
    const value = await authorised(organisationId);
    if (!value) return { ok: false as const, error: "Import access required." };
    const summary = await readApprovedRecoverySummary(value.client, organisationId);
    if (!summary) return { ok: false as const, error: "Recovery status could not be loaded." };
    return { ok: true as const, summary };
  } catch {
    return { ok: false as const, error: "Recovery status could not be loaded." };
  }
}

export async function recoverApprovedMemberImportBatchAction(organisationId: string) {
  try {
    const value = await authorised(organisationId);
    if (!value) return { ok: false as const, error: "Import access required." };
    const { error } = await value.client.rpc("club_recover_rejected_member_import_batch", {
      p_organisation_id: organisationId,
      p_batch_id: APPROVED_RECOVERY_BATCH_ID,
    });
    if (error) {
      const message = error.code === "42501"
        ? "Recovery is not authorised for this Club account."
        : error.code === "55000"
          ? "Recovery preflight did not match. No completion is assumed; review the batch before retrying."
          : "Recovery could not be confirmed. Refresh the batch status before taking any further action.";
      return { ok: false as const, error: message };
    }
    const summary = await readApprovedRecoverySummary(value.client, organisationId);
    revalidatePath("/club/members");
    revalidatePath("/club/members/import");
    if (!summary) return { ok: false as const, error: "Recovery RPC succeeded, but final counts could not be loaded. Refresh status before any retry." };
    if (summary.state !== "completed") return { ok: false as const, error: "The recovery RPC returned, but the batch is not in the expected completed state. Do not retry until reviewed.", summary };
    return { ok: true as const, summary };
  } catch {
    return { ok: false as const, error: "Recovery could not be confirmed. Refresh the batch status before taking any further action." };
  }
}

export async function stageMemberImportAction(input: { organisationId: string; filename: string; checksum?: string; headers: string[]; mapping: Record<string, string | undefined>; rows: unknown[] }) { try { const value = await authorised(input.organisationId); if (!value || !input.filename.trim() || input.rows.length > 10000) return { ok: false, error: "Import access or file is invalid." }; const { data, error } = await value.client.rpc("club_create_member_import_batch", { p_organisation_id: input.organisationId, p_filename: input.filename, p_checksum: input.checksum ?? null, p_headers: input.headers, p_mapping: input.mapping, p_rows: input.rows }); if (error) return { ok: false, error: "The member file could not be staged." }; revalidatePath("/club/members/import"); return { ok: true, batch: data }; } catch { return { ok: false, error: "The member file could not be staged." }; } }
export async function getMemberImportBatchAction(organisationId: string, batchId: string) { try { const value = await authorised(organisationId); if (!value) return { ok: false, error: "Import access required." }; const { data, error } = await value.client.rpc("club_list_member_import_batch", { p_organisation_id: organisationId, p_batch_id: batchId }); if (error) return { ok: false, error: "Import report could not be loaded." }; return { ok: true, report: data }; } catch { return { ok: false, error: "Import report could not be loaded." }; } }
export async function authoriseMemberImportAction(organisationId: string, batchId: string) { try { const value = await authorised(organisationId); if (!value) return { ok: false, error: "Import access required." }; const { data, error } = await value.client.rpc("club_confirm_member_import_batch", { p_organisation_id: organisationId, p_batch_id: batchId }); if (error) return { ok: false, error: "Resolve blocking issues before authorising." }; revalidatePath("/club/members/import"); return { ok: true, batch: data }; } catch { return { ok: false, error: "Import could not be authorised." }; } }
export async function mapMemberImportPackageAction(input: { organisationId: string; batchId: string; sourcePackage: string; clubProductId: string }) { try { const value = await authorised(input.organisationId); if (!value) return { ok: false, error: "Import access required." }; const { error } = await value.client.rpc("club_map_member_import_package", { p_organisation_id: input.organisationId, p_batch_id: input.batchId, p_source_package: input.sourcePackage, p_club_product_id: input.clubProductId, p_status: "mapped" }); if (error) return { ok: false, error: "Package mapping could not be saved." }; const report = await value.client.rpc("club_list_member_import_batch", { p_organisation_id: input.organisationId, p_batch_id: input.batchId }); revalidatePath("/club/members/import"); return { ok: true, batch: (report.data as { batch?: unknown } | null)?.batch }; } catch { return { ok: false, error: "Package mapping could not be saved." }; } }
export async function executeMemberImportAction(organisationId: string, batchId: string) { try { const value = await authorised(organisationId); if (!value) return { ok: false, error: "Import access required." }; const { data, error } = await value.client.rpc("club_execute_member_import_batch", { p_organisation_id: organisationId, p_batch_id: batchId }); if (error) return { ok: false, error: "Import could not be completed." }; revalidatePath("/club/members"); revalidatePath("/club/members/import"); return { ok: true, batch: data }; } catch { return { ok: false, error: "Import could not be completed." }; } }

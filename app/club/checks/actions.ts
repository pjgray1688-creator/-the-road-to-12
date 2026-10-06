"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

function text(formData: FormData, name: string) { return String(formData.get(name) ?? "").trim(); }
function optional(formData: FormData, name: string) { const value = text(formData, name); return value || null; }
async function contextFor(formData: FormData) {
  const organisationId = text(formData, "organisationId");
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  return { client, user, organisationId, context: user && organisationId ? await resolveClubOperationalContext(client, user.id, organisationId) : undefined };
}
function refresh(organisationId: string) { revalidatePath(`/club/checks?org=${encodeURIComponent(organisationId)}`); revalidatePath("/club"); }

export async function recordChecklistItemAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_record_checklist_item", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId"), p_item_id: text(formData, "itemId"), p_status: text(formData, "status"), p_note: optional(formData, "note") }); refresh(organisationId);
}

export async function recordEquipmentCheckAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_record_equipment_check", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId"), p_asset_id: text(formData, "assetId"), p_status: text(formData, "status"), p_note: optional(formData, "note"), p_media_reference: optional(formData, "mediaReference") }); refresh(organisationId);
}

export async function reportMaintenanceIssueAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_report_maintenance_issue", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId"), p_asset_id: optional(formData, "assetId"), p_description: text(formData, "description"), p_priority: text(formData, "priority") || "normal", p_out_of_service: formData.get("outOfService") === "on", p_media_reference: optional(formData, "mediaReference") }); refresh(organisationId);
}

export async function submitDailyCheckAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_submit_daily_check", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId") }); refresh(organisationId);
}

export async function reopenDailyCheckAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_reopen_daily_check", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId") }); refresh(organisationId);
}

export async function setMaintenanceStatusAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_set_maintenance_status", { p_organisation_id: organisationId, p_issue_id: text(formData, "issueId"), p_status: text(formData, "status"), p_note: optional(formData, "note"), p_return_to_service: formData.get("returnToService") === "on" }); refresh(organisationId);
}

export async function createChecklistTemplateAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_checklist_create_template", { p_organisation_id: organisationId, p_name: text(formData, "name"), p_check_type: text(formData, "checkType") || "daily" }); refresh(organisationId);
}

export async function assignChecklistTemplateAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_checklist_assign_template", { p_organisation_id: organisationId, p_template_id: text(formData, "templateId"), p_location_id: text(formData, "locationId") }); refresh(organisationId);
}

export async function saveChecklistItemAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_checklist_save_item", { p_organisation_id: organisationId, p_template_id: text(formData, "templateId"), p_item_id: optional(formData, "itemId"), p_section: text(formData, "section"), p_label: text(formData, "label"), p_required: formData.get("required") === "on", p_sort_order: Number(formData.get("sortOrder") ?? 0), p_active: true }); refresh(organisationId);
}

export async function saveEquipmentAssetAction(formData: FormData) {
  const { client, organisationId, context } = await contextFor(formData); if (!context) return;
  await client.rpc("club_equipment_save_asset", { p_organisation_id: organisationId, p_location_id: text(formData, "locationId"), p_asset_id: optional(formData, "assetId"), p_name: text(formData, "name"), p_category: text(formData, "category"), p_manufacturer: optional(formData, "manufacturer"), p_model: optional(formData, "model"), p_serial_reference: optional(formData, "serialReference"), p_check_frequency_days: Number(formData.get("frequencyDays") ?? 1), p_active: formData.get("active") !== "off" }); refresh(organisationId);
}

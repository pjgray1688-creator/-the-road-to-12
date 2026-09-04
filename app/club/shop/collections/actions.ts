"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

async function authorised(org: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;
  const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "commerce.collections_manage"))) return;
  return { client };
}

export async function confirmCollectionAction(org: string, orderId: string) {
  const v = await authorised(org);
  if (!v) return { ok: false, error: "Collection access required." };
  const { data, error } = await v.client.rpc("club_confirm_collection", { p_organisation_id: org, p_order_id: orderId });
  if (error) return { ok: false, error: "This order is not ready for collection." };
  revalidatePath("/club/shop/collections");
  revalidatePath("/club/shop");
  return { ok: true, collection: data };
}

export async function confirmShelfReadyAction(org: string, demandId: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };
  const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "supplier.receive"))) return { ok: false, error: "Supplier receiving access required." };
  const { data, error } = await client.rpc("club_confirm_supplier_shelf_ready", { p_organisation_id: org, p_demand_id: demandId });
  if (error) return { ok: false, error: "This allocation is not ready for shelf placement." };
  revalidatePath("/club/shop/collections"); revalidatePath("/club");
  return { ok: true, demand: data };
}

export async function scanShelfReminderAction(org: string, code: string, locationId: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };
  const context = await resolveClubOrganisationContext(client, user.id, org);
  if (!context || !(await context.repository.hasCapability(org, user.id, "supplier.receive"))) return { ok: false, error: "Supplier receiving access required." };
  const { data, error } = await client.rpc("club_scan_collection_shelf_reminder", { p_organisation_id: org, p_collection_code: code, p_location_id: locationId });
  if (error) return { ok: false, error: "That parcel is not eligible for a shelf reminder." };
  revalidatePath("/club/shop/collections"); return { ok: true, result: data };
}

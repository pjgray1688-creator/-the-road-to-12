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

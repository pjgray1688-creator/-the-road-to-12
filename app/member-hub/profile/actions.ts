"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";

export async function saveMyMadhouseHomeGymAction(organisationId: string, locationId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user || !locationId) return { ok: false as const, error: "Choose a home gym and try again." };
  const { error } = await client.rpc("club_set_my_home_location_self", {
    p_organisation_id: organisationId,
    p_location_id: locationId,
  });
  if (error) return { ok: false as const, error: "Your home gym could not be saved. Choose one of the active Madhouse gyms and try again." };
  revalidatePath("/member-hub");
  revalidatePath("/member-hub/shop");
  revalidatePath("/member-hub/profile");
  return { ok: true as const };
}

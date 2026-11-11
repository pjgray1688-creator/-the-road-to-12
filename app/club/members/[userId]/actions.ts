"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

export async function updateMemberHomeGymAction(input: { organisationId: string; userId: string; locationId: string }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in to update this member." };
  const context = await resolveClubOperationalContext(client, user.id, input.organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false as const, error: "You do not have permission to change a member’s home gym." };
  const memberExists = context.members.some(member => member.userId === input.userId && member.active);
  const location = (await context.repository.listLocations(context.organisation.id)).find(item => item.id === input.locationId && item.active);
  if (!memberExists || !location) return { ok: false as const, error: "Choose an active member and gym in this organisation." };
  try {
    await context.repository.setMemberHomeLocation(context.organisation.id, input.userId, location.id);
    revalidatePath(`/club/members/${encodeURIComponent(input.userId)}`);
    return { ok: true as const, locationName: location.name };
  } catch {
    return { ok: false as const, error: "The home gym could not be saved. No membership access was changed." };
  }
}

export async function updateMemberContactAction(input: { organisationId: string; userId: string; phone: string; addressLine1: string; addressLine2: string; townCity: string; postcode: string }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in to update contact details." };
  const context = await resolveClubOperationalContext(client, user.id, input.organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.create"))) return { ok: false as const, error: "You do not have permission to edit member contact details." };
  if (!context.members.some(member => member.userId === input.userId && member.active)) return { ok: false as const, error: "This member is not active in the selected organisation." };
  const fields = [input.phone, input.addressLine1, input.addressLine2, input.townCity, input.postcode];
  const limits = [40, 160, 160, 100, 20];
  if (fields.some((value, index) => typeof value !== "string" || value.length > limits[index]!)) return { ok: false as const, error: "Check the contact details and try again." };
  const { error } = await client.rpc("club_update_member_contact", {
    p_organisation_id: context.organisation.id, p_user_id: input.userId,
    p_phone: input.phone.trim() || null, p_address_line_1: input.addressLine1.trim() || null,
    p_address_line_2: input.addressLine2.trim() || null, p_town_city: input.townCity.trim() || null,
    p_postcode: input.postcode.trim().toUpperCase() || null,
  });
  if (error) return { ok: false as const, error: error.code === "42883" ? "Contact editing is awaiting the database update." : "Contact details could not be saved. No membership or account details were changed." };
  revalidatePath(`/club/members/${encodeURIComponent(input.userId)}`);
  revalidatePath(`/club/members/${encodeURIComponent(input.userId)}?org=${encodeURIComponent(context.organisation.id)}`);
  return { ok: true as const };
}

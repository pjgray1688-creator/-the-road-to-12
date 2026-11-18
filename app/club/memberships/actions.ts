"use server";

import { revalidatePath } from "next/cache";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { parseMinorUnits } from "@/lib/club-money";
import { validFixedTerm } from "@/lib/club-fixed-term";
import type { FixedTermUnit } from "@/lib/club";

export async function saveFixedTermMembershipProductAction(input: {
  organisationId: string; productId?: string; name: string; price: string;
  durationValue: number; durationUnit: FixedTermUnit; sellable: boolean; joiningFee: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = await serverSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to configure membership products." };
    const context = await resolveClubOperationalContext(client, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.manage")) || !["owner", "gym_admin"].includes(context.role)) {
      return { ok: false, error: "Only authorised Club management can configure fixed-term products." };
    }
    const name = input.name.trim();
    const priceMinor = parseMinorUnits(input.price);
    const joiningFeeMinor = input.joiningFee.trim() === "" ? null : parseMinorUnits(input.joiningFee);
    if (!name || name.length > 120 || priceMinor === undefined || (joiningFeeMinor === undefined) || !validFixedTerm(input.durationValue, input.durationUnit)) {
      return { ok: false, error: "Enter a valid product name, GBP price, joining fee and duration." };
    }
    const { error } = await client.rpc("club_save_fixed_term_membership_product", {
      p_organisation_id: context.organisation.id, p_product_id: input.productId ?? null,
      p_name: name, p_price_minor: priceMinor, p_duration_value: input.durationValue,
      p_duration_unit: input.durationUnit, p_sellable: input.sellable, p_joining_fee_minor: joiningFeeMinor,
    });
    if (error) return { ok: false, error: error.code === "42501" ? "The database did not authorise this product change." : "The fixed-term product could not be saved." };
    revalidatePath("/club/memberships", "page");
    revalidatePath("/club/join", "page");
    return { ok: true };
  } catch {
    return { ok: false, error: "The fixed-term product could not be saved." };
  }
}

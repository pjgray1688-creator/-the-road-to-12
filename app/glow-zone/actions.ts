"use server";
import { revalidatePath } from "next/cache";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { serverSupabase } from "@/lib/supabase-server";

export async function ensureGlowZoneCustomerAction() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email_confirmed_at) return { ok: false as const, error: "Verify your email before setting up Glow Zone." };
  const context = await resolveGlowZoneCustomerContext(client, user.id);
  if (context.state === "unavailable") return { ok: false as const, error: "Glow Zone is temporarily unavailable. Please ask reception for help." };
  if (context.state === "ready") return { ok: true as const };
  const { data, error } = await client.rpc("club_glow_ensure_customer", { p_organisation_id: context.organisation.id });
  if (error || !data) {
    console.warn("glow_customer_setup_failed", { code: error?.code });
    return { ok: false as const, error: error?.code === "23505" ? "We found customer details that need a quick identity check. Please ask Glow Zone reception for help; no existing data has been changed." : "We couldn’t finish setup just now. Please try again or ask Glow Zone reception for help." };
  }
  revalidatePath("/glow-zone"); revalidatePath("/glow-zone/buy");
  return { ok: true as const };
}

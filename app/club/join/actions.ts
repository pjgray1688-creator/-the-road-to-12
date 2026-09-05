"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";

export type JoiningActionResult = { ok: true; requestId: string; status: string; productName: string; amountMinor: number; billing: string; durationDays?: number } | { ok: false; error: string };

export async function startClubJoiningAction(input: { organisationId: string; productId: string; displayName: string; email?: string; phone?: string; idempotencyKey: string }): Promise<JoiningActionResult> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to start joining." };
    const { data, error } = await supabase.rpc("club_start_membership_joining", { p_organisation_id: input.organisationId, p_product_id: input.productId, p_display_name: input.displayName, p_email: input.email ?? null, p_phone: input.phone ?? null, p_idempotency_key: input.idempotencyKey });
    if (error) return { ok: false, error: error.code === "23505" ? "An existing membership record may match these details; Madhouse staff need to review it." : "Joining could not be started. Check your details and try again." };
    const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const request = (result.request && typeof result.request === "object" ? result.request : {}) as Record<string, unknown>;
    const product = (result.product && typeof result.product === "object" ? result.product : {}) as Record<string, unknown>;
    revalidatePath(`/club/join?org=${encodeURIComponent(input.organisationId)}`); revalidatePath(`/club?org=${encodeURIComponent(input.organisationId)}`);
    return { ok: true, requestId: String(request.id), status: String(request.status), productName: String(product.name), amountMinor: Number(product.price_minor), billing: String(product.billing), ...(product.duration_days != null ? { durationDays: Number(product.duration_days) } : {}) };
  } catch { return { ok: false, error: "Joining could not be started." }; }
}

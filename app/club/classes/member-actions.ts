"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import type { ClubClassBooking } from "@/lib/club-operations";
import { createStripeClassCheckoutSession, expireStripeClassCheckoutSession, retrieveStripeClassCheckoutSession } from "@/lib/stripe-join-provider";
import { siteUrl } from "@/lib/site-url";
type Result = { ok: true; booking: ClubClassBooking } | { ok: false; error: string };
async function context() { const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) return undefined; const organisation = await resolveClubOrganisationContext(client, user.id); return organisation ? { ...organisation, client, userId: user.id } : undefined; }
export async function bookMemberClassAction(input: { sessionId: string; funding: "included" | "class_credit" | "stripe" | "cash" }): Promise<Result & { checkoutUrl?: string; message?: string }> {
  try {
    const resolved = await context();
    if (!resolved) return { ok: false, error: "Sign in to book a class." };
    if (input.funding === "stripe" || input.funding === "cash") {
      const method = input.funding === "stripe" ? "stripe" : "gym_drop_box";
      const { data, error } = await resolved.client.rpc("club_start_member_payg_class_booking", { p_session_id: input.sessionId, p_payment_method: method, p_idempotency_key: randomUUID() });
      if (error || !data || typeof data !== "object") return { ok: false, error: error?.message ?? "This class could not be booked." };
      const payload = data as Record<string, unknown>; const row = payload.booking as Record<string, unknown> | undefined;
      if (!row) return { ok: false, error: "This class could not be booked." };
      const bookedAt = String(row.booked_at ?? new Date().toISOString());
      const booking: ClubClassBooking = { id: String(row.id), organisationId: String(row.organisation_id), sessionId: String(row.session_id), customerId: String(row.customer_id), status: String(row.status) as ClubClassBooking["status"], bookedAt, createdAt: String(row.created_at ?? bookedAt), updatedAt: String(row.updated_at ?? bookedAt), attendanceState: String(row.attendance_state ?? "pending") as ClubClassBooking["attendanceState"], paymentReference: row.payment_reference ? String(row.payment_reference) : undefined };
      if (method === "gym_drop_box") {
        revalidatePath("/club/classes");
        return { ok: true, booking, message: "Booking reserved. £10 cash is due to the gym drop box; it will remain unverified until staff reconcile it." };
      }
      const checkoutId = row.stripe_checkout_session_id ? String(row.stripe_checkout_session_id) : undefined;
      if (checkoutId) {
        const existing = await retrieveStripeClassCheckoutSession(checkoutId);
        if (existing.status === "open" && existing.url) return { ok: true, booking, checkoutUrl: existing.url };
        if (existing.status === "complete") return { ok: true, booking, message: "Stripe is verifying payment. Your booking will confirm after the signed webhook arrives." };
        return { ok: false, error: "The previous Stripe checkout is no longer open. Ask reception to release the pending reservation before trying again." };
      }
      try {
        const session = await createStripeClassCheckoutSession({ bookingId: booking.id, sessionId: booking.sessionId, amountMinor: Number(row.payment_amount_minor), currency: String(row.payment_currency), successUrl: `${siteUrl()}/club/classes?payment=returned`, cancelUrl: `${siteUrl()}/club/classes?payment=cancelled` });
        if (!session.id || !session.url || session.amount_total !== 1000 || session.payment_status !== "unpaid") throw new Error("Stripe checkout did not match the class price.");
        const { error: attachError } = await resolved.client.rpc("club_attach_class_stripe_checkout", { p_booking_id: booking.id, p_checkout_id: session.id, p_payment_intent_id: session.payment_intent });
        if (attachError) throw new Error("Checkout could not be linked to the booking.");
        return { ok: true, booking, checkoutUrl: session.url };
      } catch {
        await resolved.client.rpc("club_abort_class_stripe_booking", { p_booking_id: booking.id, p_reason: "checkout_creation_failed" });
        return { ok: false, error: "Stripe checkout could not be started. No booking was confirmed; no payment was recorded." };
      }
    }
    const rpc = input.funding === "included" ? "club_redeem_transformation_class_credit" : "club_redeem_reusable_class_credit";
    const { data, error } = await resolved.client.rpc(rpc, { p_session_id: input.sessionId });
    if (error || !data || typeof data !== "object") return { ok: false, error: error?.message ?? "This class could not be booked." };
    const row = data as Record<string, unknown>;
    const bookedAt = String(row.booked_at ?? new Date().toISOString());
    const booking: ClubClassBooking = {
      id: String(row.id), organisationId: String(row.organisation_id), sessionId: String(row.session_id), customerId: String(row.customer_id),
      status: String(row.status) as ClubClassBooking["status"], bookedAt, createdAt: String(row.created_at ?? bookedAt), updatedAt: String(row.updated_at ?? bookedAt),
      attendanceState: String(row.attendance_state ?? "pending") as ClubClassBooking["attendanceState"], entitlementUsageId: row.entitlement_usage_id ? String(row.entitlement_usage_id) : undefined,
    };
    revalidatePath("/club"); revalidatePath("/club/classes");
    return { ok: true, booking };
  } catch {
    return { ok: false, error: "This class could not be booked." };
  }
}
export async function cancelMemberClassAction(input: { bookingId: string }): Promise<Result> { try {
  const resolved = await context(); if (!resolved) return { ok: false, error: "Sign in to manage your bookings." };
  const { data: row, error } = await resolved.client.from("club_class_bookings").select("status,payment_method,stripe_checkout_session_id").eq("id", input.bookingId).maybeSingle();
  if (error || !row) return { ok: false, error: "This booking could not be verified." };
  if (row.status === "pending_payment" && row.payment_method === "stripe" && row.stripe_checkout_session_id) {
    const providerState = await retrieveStripeClassCheckoutSession(row.stripe_checkout_session_id);
    if (providerState.status === "complete" && providerState.payment_status === "paid") return { ok: false, error: "Stripe has completed payment. The signed confirmation is still being processed; try cancelling again after the booking status updates." };
    if (providerState.status === "open") {
      const expired = await expireStripeClassCheckoutSession(row.stripe_checkout_session_id);
      if (expired.status !== "expired") return { ok: false, error: "Stripe checkout could not be safely cancelled." };
    } else if (providerState.status !== "expired") return { ok: false, error: "Stripe checkout state could not be verified." };
  }
  const booking = await resolved.repository.cancelClassBooking(input.bookingId); revalidatePath("/club"); revalidatePath("/club/classes"); return { ok: true, booking };
} catch { return { ok: false, error: "This booking could not be cancelled." }; } }

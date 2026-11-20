"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { hashMemberInvitationToken, deriveMemberInvitationToken, validInvitationSecret } from "@/lib/madhouse-member-invitation-token";
import { notificationTransportAvailable } from "@/lib/notification-provider";
import { nudgeNotificationWorker } from "@/lib/notification-nudge";
import { serverSupabase } from "@/lib/supabase-server";

const MADHOUSE_ORGANISATION_ID = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";
async function authorised(organisationId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Sign in with an authorised management account." } as const;
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || context.organisation.id !== MADHOUSE_ORGANISATION_ID
    || !["owner", "gym_admin"].includes(context.role)
    || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.link_account"))) {
    return { error: "Only authorised Madhouse management can manage member invitations." } as const;
  }
  return { client, user, context } as const;
}

function invitationDeliveryReady(secret: string | undefined) {
  return process.env.R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED === "true"
    && validInvitationSecret(secret)
    && Boolean(process.env.R12_NOTIFICATION_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim())
    && notificationTransportAvailable();
}

export async function sendMadhouseMemberInvitationsAction(input: { organisationId: string; customerIds: string[] }) {
  try {
    const access = await authorised(input.organisationId);
    if ("error" in access) return { ok: false as const, error: access.error };
    const secret = process.env.R12_MADHOUSE_MEMBER_INVITATION_TOKEN_SECRET;
    if (!invitationDeliveryReady(secret) || !secret) return { ok: false as const, error: "Invitation delivery is not configured. No invitations were queued." };
    const customerIds = [...new Set(input.customerIds.filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))].slice(0, 250);
    if (!customerIds.length) return { ok: false as const, error: "There are no eligible members to invite." };
    const { data: preview, error: previewError } = await access.client.rpc("club_preview_madhouse_member_activation_invitations", { p_organisation_id: access.context.organisation.id });
    if (previewError || !preview || typeof preview !== "object") return { ok: false as const, error: "Eligibility changed or could not be checked. Refresh the preview; no invitations were queued." };
    const rows = (preview as { members?: Array<{ customer_id?: string; sendable?: boolean }> }).members ?? [];
    const sendable = new Set(rows.filter(row => row.sendable === true && typeof row.customer_id === "string").map(row => row.customer_id!));
    const selected = customerIds.filter(id => sendable.has(id));
    if (!selected.length) return { ok: false as const, error: "No selected member is currently eligible. Refresh the preview." };
    const entries = selected.map(customerId => {
      const invitationId = randomUUID();
      const token = deriveMemberInvitationToken(invitationId, secret);
      return { customerId, invitationId, tokenHash: hashMemberInvitationToken(token) };
    });
    const { data, error } = await access.client.rpc("club_queue_madhouse_member_activation_invitations", { p_organisation_id: MADHOUSE_ORGANISATION_ID, p_entries: entries });
    if (error || !data || typeof data !== "object") return { ok: false as const, error: error?.code === "54000" ? "The daily invitation limit has been reached. No new invitations were queued." : "The invitation batch could not be queued. Refresh the preview and try again." };
    const summary = data as { queued?: number; skipped?: number };
    if (Number(summary.queued ?? 0) > 0) nudgeNotificationWorker();
    revalidatePath("/club/members/activation");
    return { ok: true as const, queued: Number(summary.queued ?? 0), skipped: Number(summary.skipped ?? 0) };
  } catch {
    return { ok: false as const, error: "The invitation batch could not be queued. No membership or billing records were changed." };
  }
}

export async function redeemMadhouseMemberInvitationAction(input: { invitationId: string; token: string }) {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.invitationId) || !/^[a-f0-9]{64}$/i.test(input.token)) return { ok: false as const, state: "not_accepted" as const };
    const client = await serverSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { ok: false as const, state: "sign_in_required" as const };
    if (!user.email_confirmed_at) return { ok: false as const, state: "email_verification_required" as const };
    const tokenHash = hashMemberInvitationToken(input.token);
    const { data, error } = await client.rpc("club_redeem_madhouse_member_activation_invitation", { p_invitation_id: input.invitationId, p_token_hash: tokenHash });
    if (error || !data || typeof data !== "object") return { ok: false as const, state: "not_accepted" as const };
    const state = (data as { state?: string }).state;
    if (state === "linked" || state === "already_linked") {
      revalidatePath("/member-hub", "layout");
      return { ok: true as const, state: "linked" as const };
    }
    return { ok: false as const, state: state === "staff_verification_required" ? "staff_verification_required" as const : "not_accepted" as const };
  } catch {
    return { ok: false as const, state: "not_accepted" as const };
  }
}

"use server";

import { randomUUID } from "node:crypto";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { deliverNotification } from "@/lib/notification-provider";
import { renderNotification, type NotificationTemplateKey } from "@/lib/notification-templates";

const samples: Record<"staff_owner" | "staff_coach" | "member_activation", { templateKey: NotificationTemplateKey; payload: Record<string, unknown> }> = {
  staff_owner: { templateKey: "staff_invitation", payload: { name: "Keenan", email: "keenan@example.test", role: "owner", coachEnabled: true, organisationName: "Madhouse", venueNames: ["Rotherham", "Carlton"], expiresAt: "2026-11-14T12:00:00Z", grantId: "example-only" } },
  staff_coach: { templateKey: "staff_invitation", payload: { name: "Luke", email: "luke@example.test", role: "trainer", coachEnabled: true, organisationName: "Madhouse", venueNames: ["Rotherham", "Carlton"], expiresAt: "2026-11-14T12:00:00Z", grantId: "example-only" } },
  member_activation: { templateKey: "member_activation", payload: { name: "Alex", organisationName: "Madhouse", testMode: true } },
};

export async function sendStaffEmailPreviewTest(input: { organisationId: string; sample: keyof typeof samples; recipient: string }) {
  try {
    const client = await serverSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { ok: false as const, error: "Sign in with authorised staff access." };
    const context = await resolveClubOperationalContext(client, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage"))) return { ok: false as const, error: "Staff email preview is restricted to authorised staff managers." };
    const recipient = input.recipient.trim().toLowerCase();
    const allowlist = (process.env.R12_EMAIL_TEST_RECIPIENTS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || !allowlist.includes(recipient)) return { ok: false as const, error: "Enter an address listed in R12_EMAIL_TEST_RECIPIENTS." };
    const sample = samples[input.sample];
    if (!sample) return { ok: false as const, error: "Choose a supported preview message." };
    const rendered = renderNotification({ templateKey: sample.templateKey, payload: { ...sample.payload, testMode: true } });
    const delivery = await deliverNotification({ id: randomUUID(), recipientEmail: recipient, sender: rendered.sender, subject: rendered.subject, text: rendered.text, html: rendered.html });
    if (!delivery.ok) return { ok: false as const, error: delivery.state === "unavailable" ? "Email provider is not configured; no test email was sent." : "Test email delivery failed. Check the protected worker/provider logs." };
    return { ok: true as const, message: "Clearly marked test email sent.", from: `${rendered.senderName} <${rendered.senderAddress}>`, subject: rendered.subject };
  } catch { return { ok: false as const, error: "Test email could not be sent." }; }
}

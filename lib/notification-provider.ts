export type NotificationSender = "members" | "billing" | "staff";

export type NotificationEnvelope = {
  id: string;
  recipientEmail: string;
  sender: NotificationSender;
  subject: string;
  text: string;
  html: string;
};

export type NotificationDelivery =
  | { ok: true; provider: string; reference: string }
  | { ok: false; state: "unavailable" | "failed"; code: string; message: string; retryable: boolean };

export function notificationConfig() {
  const appBaseUrl = process.env.R12_APP_BASE_URL
    ?? (process.env.NODE_ENV === "development" ? process.env.NEXT_PUBLIC_SITE_URL : undefined)
    ?? "https://the-road-to-12.vercel.app";
  return {
    provider: process.env.R12_EMAIL_PROVIDER ?? "unavailable",
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
    from: {
      members: process.env.R12_EMAIL_FROM_MEMBERS ?? "members@r12.live",
      billing: process.env.R12_EMAIL_FROM_BILLING ?? "madhouse.accounts@r12.live",
      staff: process.env.R12_EMAIL_FROM_STAFF ?? "staff@r12.live",
    },
  } as const;
}

export function senderAddress(sender: NotificationSender) {
  return notificationConfig().from[sender];
}

/** Delivery is deliberately disabled unless a provider is explicitly configured. */
export async function deliverNotification(_envelope: NotificationEnvelope): Promise<NotificationDelivery> {
  const provider = notificationConfig().provider;
  if (provider === "mock") return { ok: true, provider: "mock", reference: `mock-${_envelope.id}` };
  return {
    ok: false,
    state: "unavailable",
    code: provider === "smtp" ? "smtp_adapter_not_configured" : "email_provider_unavailable",
    message: provider === "smtp" ? "SMTP delivery is not wired in this environment." : "Transactional email delivery is not configured.",
    retryable: false,
  };
}

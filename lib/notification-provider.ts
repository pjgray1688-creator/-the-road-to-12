import { siteUrl } from "./site-url";
import { inspectSmtpConfiguration } from "./smtp-config";
import { sendSmtpMessage } from "./smtp-transport";

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
  return {
    provider: process.env.R12_EMAIL_PROVIDER ?? "unavailable",
    appBaseUrl: siteUrl(),
    from: {
      members: process.env.R12_EMAIL_FROM_MEMBERS ?? "members@r12.live",
      billing: process.env.R12_EMAIL_FROM_BILLING ?? "madhouse.accounts@r12.live",
      staff: process.env.R12_EMAIL_FROM_STAFF ?? "staff@r12.live",
    },
    fromNames: {
      members: process.env.R12_EMAIL_FROM_NAME_MEMBERS ?? "R12 · Madhouse",
      billing: process.env.R12_EMAIL_FROM_NAME_BILLING ?? "Madhouse Accounts · R12",
      staff: process.env.R12_EMAIL_FROM_NAME_STAFF ?? "R12 · Madhouse Staff",
    },
  } as const;
}

/** SMTP is available only with complete authenticated TLS configuration; mock is non-production only. */
export function notificationTransportAvailable() {
  const config = notificationConfig();
  if (config.provider === "mock") return process.env.NODE_ENV !== "production";
  return config.provider === "smtp" && inspectSmtpConfiguration().configuration !== null;
}

export function senderAddress(sender: NotificationSender) {
  return notificationConfig().from[sender];
}

/** Delivery is deliberately disabled unless a provider is explicitly configured. */
export async function deliverNotification(_envelope: NotificationEnvelope): Promise<NotificationDelivery> {
  const provider = notificationConfig().provider;
  if (provider === "mock") return { ok: true, provider: "mock", reference: `mock-${_envelope.id}` };
  if (provider === "smtp") {
    if (!inspectSmtpConfiguration().configuration) {
      return { ok: false, state: "unavailable", code: "smtp_configuration_incomplete", message: "SMTP delivery is not configured completely.", retryable: false };
    }
    try {
      const result = await sendSmtpMessage(_envelope);
      return { ok: true, provider: result.provider, reference: result.reference };
    } catch (error) {
      const source = error as { deliveryCode?: unknown; retryable?: unknown };
      return {
        ok: false,
        state: "failed",
        code: typeof source.deliveryCode === "string" ? source.deliveryCode : "smtp_delivery_failed",
        message: "SMTP delivery failed. Check the provider connection and server logs.",
        retryable: source.retryable !== false,
      };
    }
  }
  return { ok: false, state: "unavailable", code: "email_provider_unavailable", message: "Transactional email delivery is not configured.", retryable: false };
}

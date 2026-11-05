import { siteUrl } from "./site-url";
import { inspectSmtpConfiguration } from "./smtp-config";
import { sendSmtpMessage } from "./smtp-transport";

export type NotificationSender = "members" | "billing" | "staff" | "privacy" | "apparel";

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
      privacy: process.env.R12_EMAIL_FROM_PRIVACY ?? "privacy@r12.live",
    },
    fromNames: {
      members: process.env.R12_EMAIL_FROM_NAME_MEMBERS ?? "R12 · Madhouse",
      billing: process.env.R12_EMAIL_FROM_NAME_BILLING ?? "Madhouse Accounts · R12",
      staff: process.env.R12_EMAIL_FROM_NAME_STAFF ?? "R12 · Madhouse Staff",
      privacy: process.env.R12_EMAIL_FROM_NAME_PRIVACY ?? "R12",
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
  if (sender === "apparel") return process.env.MADHOUSE_APPAREL_EMAIL_FROM?.trim() ?? "";
  return notificationConfig().from[sender];
}

/** Delivery is deliberately disabled unless a provider is explicitly configured. */
export async function deliverNotification(_envelope: NotificationEnvelope): Promise<NotificationDelivery> {
  if (_envelope.sender === "apparel") {
    const from = process.env.MADHOUSE_APPAREL_EMAIL_FROM?.trim() ?? "";
    if (process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED !== "true" || !/^[^\s@<>]+@madhousegym\.online$/i.test(from)) {
      return { ok: false, state: "unavailable", code: "madhouse_sender_not_verified", message: "Madhouse Apparel sender identity is not verified.", retryable: false };
    }
  }
  const provider = notificationConfig().provider;
  if (_envelope.sender === "apparel" && provider !== "smtp") {
    return { ok: false, state: "unavailable", code: "madhouse_smtp_required", message: "Madhouse Apparel requires its authenticated SMTP transport.", retryable: false };
  }
  if (provider === "mock") return { ok: true, provider: "mock", reference: `mock-${_envelope.id}` };
  if (provider === "smtp") {
    const smtpProfile = _envelope.sender === "apparel" ? "apparel" : "r12";
    if (!inspectSmtpConfiguration(process.env, smtpProfile).configuration) {
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

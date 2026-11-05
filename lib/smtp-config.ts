export type SmtpFieldState = "configured" | "missing" | "invalid";
export type SmtpFieldCheck = { key: string; label: string; state: SmtpFieldState; detail: string };

export type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  username: string;
  password: string;
  from: Record<"members" | "staff" | "billing", { address: string; name: string }> & Partial<Record<"privacy", { address: string; name: string }>>;
};
export type SmtpProfile = "r12" | "apparel";

const validAddress = (value: string) => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/[\r\n]/.test(value);
const field = (key: string, label: string, state: SmtpFieldState, detail: string): SmtpFieldCheck => ({ key, label, state, detail });

function parseHost(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return { state: "missing" as const, value: null, detail: "Set SMTP_HOST to the provider hostname." };
  const valid = !/[\s/@?#]/.test(value) && !value.includes("://") && value.length <= 253 && /^[a-z0-9.-]+$/i.test(value) && !value.startsWith(".") && !value.endsWith(".");
  return valid
    ? { state: "configured" as const, value, detail: "Hostname is present; provider connectivity is not tested." }
    : { state: "invalid" as const, value: null, detail: "Use a hostname only, without a URL, port, or path." };
}

function parsePort(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return { state: "missing" as const, value: null, detail: "Set SMTP_PORT to the provider TCP port." };
  if (!/^\d+$/.test(value)) return { state: "invalid" as const, value: null, detail: "SMTP_PORT must be a whole number from 1 to 65535." };
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { state: "invalid" as const, value: null, detail: "SMTP_PORT must be a whole number from 1 to 65535." };
  return { state: "configured" as const, value: port, detail: "TCP port is syntactically valid; provider connectivity is not tested." };
}

function parseSecure(raw: string | undefined) {
  const value = raw?.trim();
  if (value === "true") return { state: "configured" as const, value: true, detail: "Implicit TLS is selected." };
  if (value === "false") return { state: "configured" as const, value: false, detail: "STARTTLS is required; plaintext downgrade is not allowed." };
  return { state: value ? "invalid" as const : "missing" as const, value: null, detail: value ? "Set SMTP_SECURE strictly to true or false." : "Set SMTP_SECURE explicitly to true (implicit TLS) or false (required STARTTLS)." };
}

export function inspectSmtpConfiguration(env: NodeJS.ProcessEnv = process.env, profile: SmtpProfile = "r12") {
  const apparel = profile === "apparel";
  const host = parseHost(apparel ? env.MADHOUSE_APPAREL_SMTP_HOST : env.SMTP_HOST);
  const port = parsePort(apparel ? env.MADHOUSE_APPAREL_SMTP_PORT : env.SMTP_PORT);
  const secure = parseSecure(apparel ? env.MADHOUSE_APPAREL_SMTP_SECURE : env.SMTP_SECURE);
  const username = (apparel ? env.MADHOUSE_APPAREL_SMTP_USERNAME : env.SMTP_USERNAME)?.trim() || undefined;
  const password = (apparel ? env.MADHOUSE_APPAREL_SMTP_PASSWORD : env.SMTP_PASSWORD) || undefined;
  const authState: SmtpFieldState = username && password ? "configured" : !username && !password ? "missing" : "invalid";
  const prefix = apparel ? "MADHOUSE_APPAREL_SMTP" : "SMTP";
  const authDetail = authState === "configured" ? "SMTP authentication credentials are both present; values are hidden." : authState === "missing" ? `Set ${prefix}_USERNAME and ${prefix}_PASSWORD; authenticated delivery is required.` : `Set both ${prefix}_USERNAME and ${prefix}_PASSWORD.`;

  const senderInputs = {
    members: { address: env.R12_EMAIL_FROM_MEMBERS?.trim() || "members@r12.live", name: env.R12_EMAIL_FROM_NAME_MEMBERS?.trim() || "R12 · Madhouse" },
    staff: { address: env.R12_EMAIL_FROM_STAFF?.trim() || "staff@r12.live", name: env.R12_EMAIL_FROM_NAME_STAFF?.trim() || "R12 · Madhouse Staff" },
    billing: { address: env.R12_EMAIL_FROM_BILLING?.trim() || "madhouse.accounts@r12.live", name: env.R12_EMAIL_FROM_NAME_BILLING?.trim() || "Madhouse Accounts · R12" },
    privacy: { address: env.R12_EMAIL_FROM_PRIVACY?.trim() || "privacy@r12.live", name: env.R12_EMAIL_FROM_NAME_PRIVACY?.trim() || "R12" },
  };
  const senders = apparel
    ? [field(
        "smtpSenderApparel",
        "Madhouse Apparel sender identity",
        validAddress(env.MADHOUSE_APPAREL_EMAIL_FROM?.trim() ?? "")
          && (env.MADHOUSE_APPAREL_EMAIL_FROM_NAME?.trim() || "Madhouse Apparel").length > 0
          && !/[\r\n]/.test(env.MADHOUSE_APPAREL_EMAIL_FROM_NAME ?? "") ? "configured" : "invalid",
        "Madhouse Apparel sender address and display name are syntactically valid; domain authentication is external.",
      )]
    : Object.entries(senderInputs).map(([key, sender]) => field(
        `smtpSender${key[0].toUpperCase()}${key.slice(1)}`,
        `${key === "billing" ? "Accounts" : key[0].toUpperCase() + key.slice(1)} sender identity`,
        validAddress(sender.address) && sender.name.length > 0 && !/[\r\n]/.test(sender.name) ? "configured" : "invalid",
        validAddress(sender.address) ? "Sender address is syntactically valid; domain authentication is external." : "Set this sender to a valid email address.",
      ));

  const securePortValid = port.value === null || secure.value === null || (secure.value ? port.value === 465 : port.value !== 465);
  const checks: SmtpFieldCheck[] = [
    field("smtpHost", apparel ? "Madhouse Apparel SMTP host" : "SMTP host", host.state, host.detail),
    field("smtpPort", apparel ? "Madhouse Apparel SMTP port" : "SMTP port", port.state, port.detail),
    field("smtpSecure", apparel ? "Madhouse Apparel SMTP TLS / secure mode" : "SMTP TLS / secure mode", !securePortValid ? "invalid" : secure.state, !securePortValid ? "Use implicit TLS on port 465, or required STARTTLS on another port." : secure.detail),
    field("smtpAuth", apparel ? "Madhouse Apparel SMTP authentication" : "SMTP authentication", authState, authDetail),
    ...senders,
  ];
  const state = checks.some(check => check.state === "invalid")
    ? "invalid" as const
    : checks.some(check => check.state === "missing") ? "missing" as const : "configured" as const;
  const configuration = state === "configured" && host.value && port.value && secure.value !== null
    ? {
        host: host.value,
        port: port.value,
        secure: secure.value,
        requireTLS: !secure.value,
        username: username!, password: password!,
        from: senderInputs,
      }
    : null;
  return { state, checks, configuration };
}

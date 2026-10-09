export type SmtpFieldState = "configured" | "missing" | "invalid";
export type SmtpFieldCheck = { key: string; label: string; state: SmtpFieldState; detail: string };

export type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  username?: string;
  password?: string;
  from: Record<"members" | "staff" | "billing", { address: string; name: string }>;
};

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

export function inspectSmtpConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const host = parseHost(env.SMTP_HOST);
  const port = parsePort(env.SMTP_PORT);
  const secure = parseSecure(env.SMTP_SECURE);
  const username = env.SMTP_USERNAME?.trim() || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  const authState: SmtpFieldState = username && password ? "configured" : !username && !password ? "missing" : "invalid";
  const authDetail = authState === "configured" ? "SMTP authentication credentials are both present; values are hidden." : authState === "missing" ? "No SMTP authentication credentials are set; use only if the provider permits a trusted relay without AUTH." : "Set both SMTP_USERNAME and SMTP_PASSWORD, or neither.";

  const senderInputs = {
    members: { address: env.R12_EMAIL_FROM_MEMBERS?.trim() || "members@r12.live", name: env.R12_EMAIL_FROM_NAME_MEMBERS?.trim() || "R12" },
    staff: { address: env.R12_EMAIL_FROM_STAFF?.trim() || "staff@r12.live", name: env.R12_EMAIL_FROM_NAME_STAFF?.trim() || "R12 Staff" },
    billing: { address: env.R12_EMAIL_FROM_BILLING?.trim() || "madhouse.accounts@r12.live", name: env.R12_EMAIL_FROM_NAME_BILLING?.trim() || "Madhouse Accounts" },
  };
  const senders = Object.entries(senderInputs).map(([key, sender]) => field(
    `smtpSender${key[0].toUpperCase()}${key.slice(1)}`,
    `${key === "billing" ? "Accounts" : key[0].toUpperCase() + key.slice(1)} sender identity`,
    validAddress(sender.address) && sender.name.length > 0 && !/[\r\n]/.test(sender.name) ? "configured" : "invalid",
    validAddress(sender.address) ? "Sender address is syntactically valid; domain authentication is external." : "Set this sender to a valid email address.",
  ));

  const securePortValid = port.value === null || secure.value === null || (secure.value ? port.value === 465 : port.value !== 465);
  const checks: SmtpFieldCheck[] = [
    field("smtpHost", "SMTP host", host.state, host.detail),
    field("smtpPort", "SMTP port", port.state, port.detail),
    field("smtpSecure", "SMTP TLS / secure mode", !securePortValid ? "invalid" : secure.state, !securePortValid ? "Use implicit TLS on port 465, or required STARTTLS on another port." : secure.detail),
    field("smtpAuth", "SMTP authentication", authState, authDetail),
    ...senders,
  ];
  const requiredChecks = checks.filter(check => check.key !== "smtpAuth");
  const state = requiredChecks.some(check => check.state === "invalid") || authState === "invalid"
    ? "invalid" as const
    : requiredChecks.some(check => check.state === "missing") ? "missing" as const : "configured" as const;
  const configuration = state === "configured" && host.value && port.value && secure.value !== null
    ? {
        host: host.value,
        port: port.value,
        secure: secure.value,
        requireTLS: !secure.value,
        ...(username && password ? { username, password } : {}),
        from: senderInputs,
      }
    : null;
  return { state, checks, configuration };
}

import { appBaseUrlStatus } from "./site-url";
import { inspectSmtpConfiguration } from "./smtp-config";

export type ReadinessState = "configured" | "missing" | "invalid" | "disabled" | "adapter_unavailable" | "external_verification_required";
export type ReadinessCheck = { key: string; label: string; state: ReadinessState; detail: string };

const present = (value: string | undefined) => Boolean(value?.trim());
const presence = (key: string, label: string, value: string | undefined): ReadinessCheck => ({ key, label, state: present(value) ? "configured" : "missing", detail: present(value) ? "Value is present; its provider-side validity is not checked here." : "Required server setting is missing." });
const eitherPresence = (key: string, label: string, values: Array<string | undefined>): ReadinessCheck => presence(key, label, values.find(present));

function supabaseUrlState(value: string | undefined) {
  if (!present(value)) return { state: "missing" as const, detail: "Set NEXT_PUBLIC_SUPABASE_URL for application and worker database access." };
  try {
    const url = new URL(value!.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/") return { state: "invalid" as const, detail: "Use the HTTPS Supabase project origin." };
    return { state: "configured" as const, detail: "URL format is valid; database connectivity is not tested." };
  } catch { return { state: "invalid" as const, detail: "Set a valid HTTPS Supabase project URL." }; }
}

export function launchReadiness(env: NodeJS.ProcessEnv = process.env): ReadinessCheck[] {
  const app = appBaseUrlStatus(env);
  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  const stripeKeyValidFormat = Boolean(stripeKey && /^(sk|rk)_(live|test)_/.test(stripeKey));
  const stripeKeyState: ReadinessState = !stripeKey ? "missing" : env.NODE_ENV === "production" && stripeKey.startsWith("sk_test_") ? "invalid" : stripeKeyValidFormat ? "configured" : "invalid";
  const stripeKeyDetail = !stripeKey ? "Required server setting is missing." : stripeKeyState === "invalid" ? "Key format is unexpected or a test key is configured for production." : "Value is present; Stripe account validity is not checked here.";
  const environment = env.GOCARDLESS_ENVIRONMENT?.trim().toLowerCase();
  const smtp = inspectSmtpConfiguration(env);
  const emailProvider = env.R12_EMAIL_PROVIDER?.trim().toLowerCase();
  const emailState: ReadinessState = emailProvider !== "smtp" ? "missing" : smtp.state === "configured" ? "configured" : smtp.state;
  const productionGoCardless = env.NODE_ENV === "production";
  const goCardlessState: ReadinessState = !environment ? "missing" : !["sandbox", "live"].includes(environment) || (productionGoCardless && environment !== "live") ? "invalid" : "configured";
  const supabaseUrl = supabaseUrlState(env.NEXT_PUBLIC_SUPABASE_URL);
  return [
    { key: "appBaseUrl", label: "R12 application base URL", state: app.status, detail: `${app.effectiveUrl}${app.detail ? ` · ${app.detail}` : ` · source: ${app.source}`}` },
    { key: "supabaseUrl", label: "Supabase project URL", ...supabaseUrl },
    presence("supabaseAnon", "Supabase public client key", env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    presence("supabaseServiceRole", "Worker Supabase service-role key", env.SUPABASE_SERVICE_ROLE_KEY),
    { key: "stripeSecret", label: "Stripe secret key", state: stripeKeyState, detail: stripeKeyDetail },
    presence("stripeWebhook", "Stripe webhook signing secret", env.STRIPE_WEBHOOK_SECRET),
    presence("goCardlessToken", "GoCardless access token", env.GOCARDLESS_ACCESS_TOKEN),
    { key: "goCardlessEnvironment", label: "GoCardless environment", state: goCardlessState, detail: !environment ? "Set sandbox or live explicitly; production must be live." : goCardlessState === "invalid" ? productionGoCardless ? "Production requires GOCARDLESS_ENVIRONMENT=live." : "Use exactly sandbox or live." : `Selected environment: ${environment}.` },
    presence("goCardlessWebhook", "GoCardless webhook signing secret", env.GOCARDLESS_WEBHOOK_SECRET),
    eitherPresence("billingWorker", "Billing worker bearer secret", [env.R12_BILLING_WORKER_SECRET, env.CRON_SECRET]),
    eitherPresence("notificationWorker", "Notification worker bearer secret", [env.R12_NOTIFICATION_WORKER_SECRET, env.CRON_SECRET]),
    presence("vercelCronSecret", "Vercel Cron authentication secret", env.CRON_SECRET),
    { key: "workerSchedules", label: "Scheduled worker configuration", state: "external_verification_required", detail: "Vercel Cron runs billing daily at 06:00 UTC and notifications daily at 06:15 UTC. Queueing important notifications also nudges the authenticated worker after the app response. Confirm Cron is enabled, CRON_SECRET is set, and the notification batch limits are suitable." },
    ...smtp.checks,
    { key: "emailProvider", label: "SMTP delivery provider", state: emailState, detail: emailProvider !== "smtp" ? "Set R12_EMAIL_PROVIDER=smtp to enable authenticated SMTP; no secrets are displayed here." : emailState === "configured" ? "SMTP settings are present and syntactically valid; provider connectivity and domain authentication are not tested." : `SMTP configuration is ${smtp.state}; see the checks above. Delivery fails closed until complete.` },
    { key: "memberActivationGate", label: "Member activation email release", state: env.R12_MEMBER_ACTIVATION_EMAILS_ENABLED === "true" ? "configured" : "disabled", detail: env.R12_MEMBER_ACTIVATION_EMAILS_ENABLED === "true" ? "Imported member activation intents are eligible for delivery by worker nudges and the daily safety sweep." : "Member activation emails are held in the outbox. Enable only after preview/test and launch approval." },
  ];
}

import { appBaseUrlStatus } from "./site-url";
import { inspectSmtpConfiguration } from "./smtp-config";

export type ReadinessState = "configured" | "missing" | "invalid" | "adapter_unavailable" | "external_verification_required";
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
    { key: "workerSchedules", label: "Scheduled worker configuration", state: "external_verification_required", detail: "vercel.json declares hourly membership billing and five-minute queued supplier imports; verify the deployed Vercel project and plan. Notification delivery is intentionally unscheduled until a real SMTP adapter is available." },
    ...smtp.checks,
    { key: "emailProvider", label: "SMTP delivery adapter", state: "adapter_unavailable", detail: "SMTP transport is not installed in this repository state; configuration alone cannot deliver mail." },
  ];
}

import { appBaseUrlStatus } from "./site-url";

export type ReadinessState = "configured" | "missing" | "invalid";
export type ReadinessCheck = { key: string; label: string; state: ReadinessState; detail: string };

const present = (value: string | undefined) => Boolean(value?.trim());
const presence = (key: string, label: string, value: string | undefined): ReadinessCheck => ({ key, label, state: present(value) ? "configured" : "missing", detail: present(value) ? "Value is present; its provider-side validity is not checked here." : "Required server setting is missing." });

export function launchReadiness(env: NodeJS.ProcessEnv = process.env): ReadinessCheck[] {
  const app = appBaseUrlStatus(env);
  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  const stripeKeyValidFormat = Boolean(stripeKey && /^(sk|rk)_(live|test)_/.test(stripeKey));
  const stripeKeyState: ReadinessState = !stripeKey ? "missing" : env.NODE_ENV === "production" && stripeKey.startsWith("sk_test_") ? "invalid" : stripeKeyValidFormat ? "configured" : "invalid";
  const stripeKeyDetail = !stripeKey ? "Required server setting is missing." : stripeKeyState === "invalid" ? "Key format is unexpected or a test key is configured for production." : "Value is present; Stripe account validity is not checked here.";
  const environment = env.GOCARDLESS_ENVIRONMENT?.trim().toLowerCase();
  const emailProvider = env.R12_EMAIL_PROVIDER?.trim().toLowerCase();
  const emailState: ReadinessState = !emailProvider || emailProvider === "unavailable" ? "missing" : emailProvider === "mock" || emailProvider === "smtp" ? "invalid" : "invalid";
  const emailDetail = !emailProvider || emailProvider === "unavailable"
    ? "No live transactional email adapter is configured; the app currently records delivery as unavailable."
    : emailProvider === "mock" ? "Mock delivery is not real email and must not be used in production." : "This provider is not implemented by the current delivery adapter.";
  return [
    { key: "appBaseUrl", label: "R12 application base URL", state: app.status, detail: `${app.effectiveUrl}${app.detail ? ` · ${app.detail}` : ` · source: ${app.source}`}` },
    { key: "stripeSecret", label: "Stripe secret key", state: stripeKeyState, detail: stripeKeyDetail },
    presence("stripeWebhook", "Stripe webhook signing secret", env.STRIPE_WEBHOOK_SECRET),
    presence("goCardlessToken", "GoCardless access token", env.GOCARDLESS_ACCESS_TOKEN),
    { key: "goCardlessEnvironment", label: "GoCardless environment", state: !environment ? "missing" : ["sandbox", "live"].includes(environment) ? "configured" : "invalid", detail: !environment ? "Set sandbox or live explicitly; the integration otherwise defaults safely to sandbox." : ["sandbox", "live"].includes(environment) ? `Selected environment: ${environment}.` : "Use exactly sandbox or live." },
    presence("goCardlessWebhook", "GoCardless webhook signing secret", env.GOCARDLESS_WEBHOOK_SECRET),
    presence("billingWorker", "Billing worker bearer secret", env.R12_BILLING_WORKER_SECRET ?? env.CRON_SECRET),
    presence("notificationWorker", "Notification worker bearer secret", env.R12_NOTIFICATION_WORKER_SECRET ?? env.CRON_SECRET),
    { key: "emailProvider", label: "Transactional email delivery", state: emailState, detail: emailDetail },
    presence("supabaseServiceRole", "Worker Supabase service-role key", env.SUPABASE_SERVICE_ROLE_KEY),
  ];
}

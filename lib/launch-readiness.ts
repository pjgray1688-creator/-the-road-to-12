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
  const stripeMode = env.STRIPE_MEMBERSHIP_MODE?.trim().toLowerCase();
  const stripeAccount = env.STRIPE_FRANCHISE_ACCOUNT_ID?.trim();
  const stripeModeState: ReadinessState = !stripeMode ? "missing" : !["test", "live"].includes(stripeMode) || (env.NODE_ENV === "production" && stripeMode !== "live") ? "invalid" : "configured";
  const stripeKeyValidFormat = Boolean(stripeKey && /^sk_(live|test)_/.test(stripeKey));
  const stripeKeyMatchesMode = Boolean(stripeKey && stripeMode && stripeKey.startsWith(`sk_${stripeMode}_`));
  const stripeKeyState: ReadinessState = !stripeKey ? "missing" : stripeKeyValidFormat && stripeKeyMatchesMode && !(env.NODE_ENV === "production" && stripeKey.startsWith("sk_test_")) ? "configured" : "invalid";
  const stripeKeyDetail = !stripeKey ? "Required server setting is missing." : stripeKeyState === "invalid" ? "Use a Stripe secret key matching the explicit membership mode; production must use live mode." : "Format and mode agree; Checkout verifies the configured Franchise account with Stripe.";
  const classStripeKey = env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY?.trim();
  const classStripeKeyState: ReadinessState = !classStripeKey ? "missing" : !/^sk_(test|live)_/.test(classStripeKey) ? "invalid" : classStripeKey.startsWith("sk_live_") && env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED !== "true" ? "disabled" : classStripeKey.startsWith("sk_test_") && env.NODE_ENV === "production" ? "invalid" : "configured";
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
    { key: "clubStationSession", label: "Shared Club station session signing key", state: env.R12_CLUB_STATION_SESSION_SECRET && Buffer.byteLength(env.R12_CLUB_STATION_SESSION_SECRET) >= 32 ? "configured" : "missing", detail: "A random server-only key of at least 32 bytes is required to bind station unlocks to the selected signed-in staff identity." },
    { key: "stripeSecret", label: "Stripe secret key", state: stripeKeyState, detail: stripeKeyDetail },
    { key: "stripeMembershipMode", label: "Stripe membership mode", state: stripeModeState, detail: !stripeMode ? "Set test or live explicitly; production must be live." : stripeModeState === "invalid" ? "Use exactly test or live; production requires live." : `Selected mode: ${stripeMode}.` },
    { key: "stripeFranchiseAccount", label: "Stripe Franchise merchant account", state: stripeAccount?.startsWith("acct_") ? "configured" : stripeAccount ? "invalid" : "missing", detail: stripeAccount?.startsWith("acct_") ? "Account ID format is valid; Checkout verifies the secret key resolves to this account." : "Set the Madhouse Franchise Limited acct_ identifier." },
    presence("stripeWebhook", "Stripe webhook signing secret", env.STRIPE_WEBHOOK_SECRET),
    { key: "madhouseClassStripe", label: "Madhouse class Stripe · Products & Services", state: classStripeKeyState, detail: classStripeKeyState === "missing" ? "Set the separate Products & Services Stripe test secret key; the membership Franchise key is never used for classes." : classStripeKeyState === "disabled" ? "Live class payments are disabled until explicitly approved." : classStripeKeyState === "invalid" ? "Use a valid test key outside production; live payment requires explicit enablement." : "Key is present; Stripe account ownership and webhook delivery still require external verification." },
    presence("madhouseClassStripeWebhook", "Products & Services class webhook signing secret", env.STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET),
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

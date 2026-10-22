import { appBaseUrlStatus } from "./site-url";
import { inspectSmtpConfiguration } from "./smtp-config";
import { stripeApiKeyMatchesMode } from "./stripe-merchant";

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
  const stripeChecks = (name: "FRANCHISE" | "PRODUCTS_SERVICES", label: string): ReadinessCheck[] => {
    const key = env[`STRIPE_${name}_SECRET_KEY`]?.trim();
    const mode = env[`STRIPE_${name}_MODE`]?.trim().toLowerCase();
    const account = env[`STRIPE_${name}_ACCOUNT_ID`]?.trim();
    const webhook = env[`STRIPE_${name}_WEBHOOK_SECRET`]?.trim();
    const liveEnabled = env[`STRIPE_${name}_LIVE_ENABLED`] === "true";
    const productionRuntime = env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview";
    const modeState: ReadinessState = !mode ? "missing" : !["test", "live"].includes(mode) || (productionRuntime && mode !== "live") ? "invalid" : "configured";
    const keyState: ReadinessState = !key ? "missing" : Boolean((mode === "test" || mode === "live") && stripeApiKeyMatchesMode(key, mode) && !(productionRuntime && mode !== "live")) ? "configured" : "invalid";
    const accountState: ReadinessState = !account ? "missing" : /^acct_[A-Za-z0-9]+$/.test(account) ? "configured" : "invalid";
    return [
      { key: `stripe${name}Secret`, label: `${label} Stripe API key`, state: keyState, detail: keyState === "configured" ? "Standard or restricted key format and mode agree; account identity is checked separately." : "Set this entity’s own test/live standard or restricted API key matching its explicit mode." },
      { key: `stripe${name}Mode`, label: `${label} Stripe mode`, state: modeState, detail: !mode ? "Set test or live explicitly; production must be live." : modeState === "invalid" ? "Use exactly test or live; production requires live." : `Selected mode: ${mode}.` },
      { key: `stripe${name}Account`, label: `${label} Stripe account`, state: accountState, detail: accountState === "configured" ? "Account ID format is present; Checkout verifies it against the API key." : `Set this entity’s exact Stripe acct_ identifier.` },
      { key: `stripe${name}Webhook`, label: `${label} Stripe webhook secret`, state: webhook?.startsWith("whsec_") ? "configured" : webhook ? "invalid" : "missing", detail: webhook?.startsWith("whsec_") ? "Endpoint signing secret is present; delivery is not tested here." : "Set this entity’s endpoint-specific webhook signing secret." },
      { key: `stripe${name}LiveCheckout`, label: `${label} live Checkout release gate`, state: liveEnabled ? "configured" : "disabled", detail: liveEnabled ? "Live Checkout is enabled. Retain account-owner verification and one controlled account-specific payment record." : "Live Checkout creation is blocked until the account owner verifies this legal entity and its Stripe account routing." },
    ];
  };
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
    ...stripeChecks("FRANCHISE", "Madhouse Franchise Limited"),
    ...stripeChecks("PRODUCTS_SERVICES", "Madhouse Products and Services Limited"),
    { key: "stripeMerchantIsolation", label: "Stripe legal-entity account isolation", state: env.STRIPE_FRANCHISE_ACCOUNT_ID && env.STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID && env.STRIPE_FRANCHISE_ACCOUNT_ID !== env.STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID ? "configured" : "invalid", detail: "The two configured Stripe account IDs must be present and distinct; live account identity is verified separately." },
    presence("madhouseClassStripeWebhook", "Products & Services class webhook signing secret", env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET),
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

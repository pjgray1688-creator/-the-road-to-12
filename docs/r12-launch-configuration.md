# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://the-road-to-12.vercel.app` (preferred canonical app origin). `NEXT_PUBLIC_SITE_URL` is a legacy fallback; neither may point at `r12.live`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, and `GOCARDLESS_ENVIRONMENT=live` after the live provider setup is verified. The integration defaults to sandbox if the environment is omitted; set it explicitly.
- `R12_BILLING_WORKER_SECRET` and `R12_NOTIFICATION_WORKER_SECRET`. `CRON_SECRET` is supported as a fallback, but dedicated secrets are preferred.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for protected server workers. Keep the service-role key server-only.

Application transactional email uses these server-only environment variables:

- `R12_EMAIL_PROVIDER=smtp` selects the application SMTP transport when that adapter is included in the deployed build.
- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE` (strictly `true` or `false`). Use `true` with implicit TLS on port 465; use `false` with required STARTTLS on another port (commonly 587). The app does not allow a plaintext downgrade.
- `SMTP_USERNAME` and `SMTP_PASSWORD` must be supplied together when the SMTP service requires authentication. Both may be omitted only when the provider explicitly permits a trusted relay without AUTH.
- `R12_EMAIL_FROM_MEMBERS=members@r12.live`, `R12_EMAIL_FROM_STAFF=staff@r12.live`, and `R12_EMAIL_FROM_BILLING=madhouse.accounts@r12.live` select the existing member, staff, and accounts sender identities. Optional display names are `R12_EMAIL_FROM_NAME_MEMBERS`, `R12_EMAIL_FROM_NAME_STAFF`, and `R12_EMAIL_FROM_NAME_BILLING`.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects the notification worker.

SMTP variables and sender identities are configuration only; the protected Launch readiness page does not connect to the provider or verify sender-domain authentication. SPF, DKIM, and DMARC must be configured with the selected SMTP provider/domain outside this repository. Supabase Auth confirmation and password-reset SMTP is separate: configure its SMTP sender as `members@r12.live` in Supabase Auth settings.

In this checkout the Nodemailer package could not be installed because npm registry DNS is unavailable, so the real SMTP adapter is not present and notification delivery remains truthfully unavailable even if SMTP variables are set. Do not schedule the notification worker for live sends until a build containing the adapter is deployed and SMTP settings are configured. `mock` is test-only. In-app notification state remains independent and authoritative.

## Provider endpoints

- Stripe webhook: `https://the-road-to-12.vercel.app/api/webhooks/stripe`
- GoCardless webhook: `https://the-road-to-12.vercel.app/api/webhooks/gocardless`
- GoCardless redirect callback: `https://the-road-to-12.vercel.app/api/club/join/gocardless/complete`
- Membership billing worker: `GET https://the-road-to-12.vercel.app/api/internal/membership-billing-worker` with `Authorization: Bearer <R12_BILLING_WORKER_SECRET>`
- Notification delivery worker: `GET https://the-road-to-12.vercel.app/api/internal/notification-worker` with `Authorization: Bearer <R12_NOTIFICATION_WORKER_SECRET>`

Run the billing worker hourly (`0 * * * *`) using a trusted scheduler and the bearer header. The notification worker should run only after the real SMTP adapter is installed and configured; it claims durable outbox rows and records delivery outcome.

Stripe Checkout uses the server secret key and does not require a publishable key. Subscribe the Stripe endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`. Copy the endpoint-specific signing secret into `STRIPE_WEBHOOK_SECRET`.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL and explicit GoCardless live mode; redeploy through the normal release workflow.
2. Create/verify Stripe live webhook endpoint and selected events; store its signing secret in Vercel. Confirm Stripe is using the intended live account.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Configure the hourly billing worker scheduler and protect it with the dedicated bearer secret. Verify worker responses/logs without triggering real collection runs outside the approved operational test plan.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup. Transactional application email remains unavailable until a real adapter is selected and implemented.
6. Open Club → More → Launch readiness as an authorised owner/admin. It reports configuration presence/format and whether a delivery adapter is present, never secret values; it cannot verify provider connectivity, sender-domain authentication, or provider-dashboard setup.

## Notification lease recovery and delivery guarantees

The notification worker claims outbox rows using the existing `FOR UPDATE SKIP LOCKED` RPC and a ten-minute lease. The unapplied forward migration `2026-12-08-notification-claim-recovery.sql`, once reviewed and applied through the normal workflow, returns expired `processing` claims to the retry path, clears the stale lease, and records a non-secret diagnostic reason. Attempts remain bounded at three; an expired final attempt is marked failed for review. A live lease and a `sent` intent are never reclaimed. Re-running the same intent preserves its outbox identity/idempotency key.

SMTP acceptance and saving the local `sent` state are two separate systems. If SMTP accepts a message and the worker crashes before the database completion RPC, the lease will eventually be recovered and a duplicate delivery is possible. Ordinary SMTP offers no universal idempotency transaction across that boundary; a stable message identity can aid diagnosis but cannot guarantee exactly-once delivery. Delivery remains bounded and auditable, not exactly once.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

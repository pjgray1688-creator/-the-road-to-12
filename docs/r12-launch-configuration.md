# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Repository code status

- Stripe Checkout/webhook and GoCardless redirect/webhook/collection-worker paths are implemented with signed webhook validation and idempotent domain processing.
- The notification outbox uses the live stale-claim recovery, ten-minute leases, bounded three-attempt recovery, and concurrent-safe database claims.
- Billing and explicitly queued supplier imports are declared in `vercel.json`. Deployment activation and schedule support still require Vercel verification.
- Application transactional SMTP is not code-complete: no real transport adapter is installed. The notification endpoint fails closed without claiming work, and no notification cron is declared.

## External setup required

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://the-road-to-12.vercel.app` (preferred canonical app origin). `NEXT_PUBLIC_SITE_URL` is a legacy fallback; neither may point at `r12.live`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, and `GOCARDLESS_ENVIRONMENT=live` after the live provider setup is verified. The integration defaults to sandbox if the environment is omitted; set it explicitly.
- `CRON_SECRET` for Vercel Cron requests. Billing and notification workers also accept their dedicated `R12_BILLING_WORKER_SECRET` / `R12_NOTIFICATION_WORKER_SECRET` for trusted manual calls.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for protected server workers. Keep the service-role key server-only.

Application transactional email uses these server-only environment variables:

- `R12_EMAIL_PROVIDER=smtp` selects the application SMTP transport when that adapter is included in the deployed build.
- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE` (strictly `true` or `false`). Use `true` with implicit TLS on port 465; use `false` with required STARTTLS on another port (commonly 587). The app does not allow a plaintext downgrade.
- `SMTP_USERNAME` and `SMTP_PASSWORD` must be supplied together when the SMTP service requires authentication. Both may be omitted only when the provider explicitly permits a trusted relay without AUTH.
- `R12_EMAIL_FROM_MEMBERS=members@r12.live`, `R12_EMAIL_FROM_STAFF=staff@r12.live`, and `R12_EMAIL_FROM_BILLING=madhouse.accounts@r12.live` select the existing member, staff, and accounts sender identities. Optional display names are `R12_EMAIL_FROM_NAME_MEMBERS`, `R12_EMAIL_FROM_NAME_STAFF`, and `R12_EMAIL_FROM_NAME_BILLING`.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects the notification worker.

SMTP variables and sender identities are configuration only; the protected Launch readiness page does not connect to the provider or verify sender-domain authentication. SPF, DKIM, and DMARC must be configured with the selected SMTP provider/domain outside this repository. Supabase Auth confirmation and password-reset SMTP is separate: configure its SMTP sender as `members@r12.live` in Supabase Auth settings.

In this checkout the Nodemailer package could not be installed because npm registry DNS is unavailable, so the real SMTP adapter is not present and notification delivery remains truthfully unavailable even if SMTP variables are set. Do not schedule the notification worker for live sends until a build containing the adapter is deployed and SMTP settings are configured. `mock` is test-only. In-app notification state remains independent and authoritative.

## Worker operations

`vercel.json` schedules active queue workers. Vercel adds `Authorization: Bearer $CRON_SECRET` to cron requests.

| Worker | Route | Auth env var | Schedule | Purpose | External dependency |
| --- | --- | --- | --- | --- | --- |
| Membership billing collections | `GET /api/internal/membership-billing-worker` | `CRON_SECRET` (dedicated secret accepted for manual calls) | Hourly, `0 * * * *` | Claims due GoCardless obligations and creates/reconciles collections idempotently | GoCardless live credentials and applied recurring-collections migration |
| Queued supplier imports | `GET /api/internal/supplier-import-worker` | `CRON_SECRET` | Every 5 minutes, `*/5 * * * *` | Claims explicitly queued supplier-import jobs; direct Active Sports sync is separate | Applied supplier-import worker migrations; only queued work invokes supplier processing |
| Notification delivery | `GET /api/internal/notification-worker` | `CRON_SECRET` (dedicated secret accepted for manual calls) | Not scheduled yet | Materialises due notification intents and delivers the existing outbox | A real application SMTP adapter and SMTP provider configuration are not available |

The hourly and five-minute cadences require a Vercel plan supporting those frequencies (Pro or Enterprise; Hobby supports daily cron only). Confirm the deployed plan and Cron dashboard after deployment. Notification delivery intentionally remains unscheduled: while no transport exists, the endpoint returns 503 before generating or claiming intents.

Workers are safe to invoke repeatedly: billing uses durable claims and stable provider idempotency keys; supplier imports use the database claim RPC with `FOR UPDATE SKIP LOCKED`; notifications use the durable outbox and lease claims. Investigate failed responses using protected server logs and durable job/outbox state, not raw provider errors in responses.

## Provider endpoints

- Stripe webhook: `https://the-road-to-12.vercel.app/api/webhooks/stripe`
- GoCardless webhook: `https://the-road-to-12.vercel.app/api/webhooks/gocardless`
- GoCardless redirect callback: `https://the-road-to-12.vercel.app/api/club/join/gocardless/complete`
- Membership billing worker: `GET https://the-road-to-12.vercel.app/api/internal/membership-billing-worker`
- Queued supplier import worker: `GET https://the-road-to-12.vercel.app/api/internal/supplier-import-worker`
- Notification delivery worker (do not schedule until the adapter exists): `GET https://the-road-to-12.vercel.app/api/internal/notification-worker`

Vercel Cron supplies the bearer header from `CRON_SECRET`. Trusted manual calls may use the corresponding dedicated worker secret or `CRON_SECRET`; never put a secret in a URL or log.

Stripe Checkout uses the server secret key and does not require a publishable key. Subscribe the Stripe endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`. Copy the endpoint-specific signing secret into `STRIPE_WEBHOOK_SECRET`.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL and explicit GoCardless live mode; redeploy through the normal release workflow.
2. Create/verify Stripe live webhook endpoint and selected events; store its signing secret in Vercel. Confirm Stripe is using the intended live account.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Verify the deployed Vercel project is Pro/Enterprise, `CRON_SECRET` is configured, and the declared cron jobs appear in the Vercel dashboard. Verify worker responses/logs without triggering real collection runs outside the approved operational test plan.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup. Transactional application email remains unavailable until a real adapter is selected and implemented.
6. Open Club → More → Launch readiness as an authorised owner/admin. It reports configuration presence/format, repository-declared cron schedules, and adapter availability, never secret values. It cannot verify a deployed cron is active, provider connectivity, sender-domain authentication, or provider-dashboard setup.

### Supabase Auth redirects

In Supabase Authentication → URL Configuration, set the Site URL to `https://the-road-to-12.vercel.app` and allow the production callback URLs `https://the-road-to-12.vercel.app/account` and `https://the-road-to-12.vercel.app/account/reset`. Add only the required preview/development origins separately if those environments need Auth callbacks. The app constructs confirmation and password-reset redirects from the active application origin. Supabase Auth SMTP is configured separately from application transactional SMTP.

## Notification lease recovery and delivery guarantees

The notification worker claims outbox rows using the existing `FOR UPDATE SKIP LOCKED` RPC and a ten-minute lease. The live `2026-12-08-notification-claim-recovery.sql` migration returns expired `processing` claims to the retry path, clears the stale lease, and records a non-secret diagnostic reason. Attempts remain bounded at three; an expired final attempt is marked failed for review. A live lease and a `sent` intent are never reclaimed, and terminal failed rows are not bypassed. Re-running the same intent preserves its outbox identity/idempotency key.

SMTP acceptance and saving the local `sent` state are two separate systems. If SMTP accepts a message and the worker crashes before the database completion RPC, the lease will eventually be recovered and a duplicate delivery is possible. Ordinary SMTP offers no universal idempotency transaction across that boundary; a stable message identity can aid diagnosis but cannot guarantee exactly-once delivery. Delivery remains bounded and auditable, not exactly once.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

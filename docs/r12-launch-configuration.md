# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Repository code status

- Stripe Checkout/webhook and GoCardless redirect/webhook/collection-worker paths are implemented with signed webhook validation and idempotent domain processing.
- The notification outbox uses the live stale-claim recovery, ten-minute leases, bounded three-attempt recovery, and concurrent-safe database claims.
- Membership billing is scheduled daily at 06:00 UTC in `vercel.json`, compatible with Vercel Hobby. Explicitly queued supplier-import jobs retain a protected worker endpoint but are not automatically polled; the current Active Sports upload runs synchronously. Deployment activation still requires Vercel verification.
- Application transactional SMTP transport is implemented. Delivery remains disabled until server SMTP configuration is complete; the protected worker checks readiness before claiming queued work and is scheduled daily at 06:15 UTC.

## External setup required

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://the-road-to-12.vercel.app` (preferred canonical app origin). `NEXT_PUBLIC_SITE_URL` is a legacy fallback; neither may point at `r12.live`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, and `GOCARDLESS_ENVIRONMENT=live` after the live provider setup is verified. The integration defaults to sandbox if the environment is omitted; set it explicitly.
- `CRON_SECRET` for Vercel Cron requests. Billing and notification workers also accept their dedicated `R12_BILLING_WORKER_SECRET` / `R12_NOTIFICATION_WORKER_SECRET` for trusted manual calls.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for protected server workers. Keep the service-role key server-only.

Application transactional email uses these server-only environment variables:

- `R12_EMAIL_PROVIDER=smtp` selects the built-in Node SMTP transport; `mock` is test-only.
- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE` (strictly `true` or `false`). Use `true` with implicit TLS on port 465; use `false` with required STARTTLS on another port (commonly 587). The app does not allow a plaintext downgrade.
- `SMTP_USERNAME` and `SMTP_PASSWORD` are both required for authenticated delivery. The app fails closed if either is absent.
- `R12_EMAIL_FROM_MEMBERS=members@r12.live`, `R12_EMAIL_FROM_STAFF=staff@r12.live`, and `R12_EMAIL_FROM_BILLING=madhouse.accounts@r12.live` select the existing member, staff, and accounts sender identities. Optional display names are `R12_EMAIL_FROM_NAME_MEMBERS`, `R12_EMAIL_FROM_NAME_STAFF`, and `R12_EMAIL_FROM_NAME_BILLING`.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects trusted manual notification-worker calls; Vercel Cron supplies the `CRON_SECRET` bearer automatically.
- `R12_EMAIL_TEST_RECIPIENTS` is a comma-separated allowlist for the protected staff email preview/test screen.
- `R12_MEMBER_ACTIVATION_EMAILS_ENABLED` must remain unset/off until member activation templates and SMTP delivery are approved; set it to exactly `true` only when ready to release imported-member activation messages.
- `R12_NOTIFICATION_BATCH_SIZE` defaults to 100 (maximum 100); `R12_NOTIFICATION_MAX_BATCHES_PER_RUN` defaults to 10 (maximum 10). The hard invocation cap is 1,000 claimed messages and a 240-second processing budget, with no more than ten concurrent sends.

SMTP variables and sender identities are configuration only; the protected Launch readiness page does not connect to the provider or verify sender-domain authentication. SPF, DKIM, and DMARC must be configured with the selected SMTP provider/domain outside this repository. Supabase Auth confirmation and password-reset SMTP is separate: configure its SMTP sender as `members@r12.live` in Supabase Auth settings.

Application SMTP is implemented using Node's TLS/network APIs; delivery remains unavailable until the provider and all required server variables are configured. `mock` is test-only. In-app notification state remains independent and authoritative.

## Worker operations

`vercel.json` schedules membership billing and notification delivery once daily. Vercel adds `Authorization: Bearer $CRON_SECRET` to cron requests. The supplier-import worker remains available for trusted manual invocation, but no Vercel Cron polls that queue on Hobby.

| Worker | Route | Auth env var | Schedule | Purpose | External dependency |
| --- | --- | --- | --- | --- | --- |
| Membership billing collections | `GET /api/internal/membership-billing-worker` | `CRON_SECRET` (dedicated secret accepted for manual calls) | Daily at 06:00 UTC, `0 6 * * *` | Claims due GoCardless obligations and creates/reconciles collections idempotently | GoCardless live credentials and applied recurring-collections migration |
| Queued supplier imports | `GET /api/internal/supplier-import-worker` | `CRON_SECRET` | No automatic schedule; trusted manual call only | Claims explicitly queued supplier-import jobs; direct Active Sports sync is separate and synchronous | Applied supplier-import worker migrations; queued work waits until this endpoint is invoked |
| Notification delivery | `GET /api/internal/notification-worker` | `CRON_SECRET` (dedicated secret accepted for server-side queue nudges) | Post-response nudge after important queue actions; daily 06:15 UTC Cron safety sweep (`15 6 * * *`) | Materialises due notification intents and drains bounded outbox batches | SpaceMail SMTP credentials and authenticated sender domain |

The billing and notification Cron schedules remain daily to fit the current Vercel Hobby assumption (Hobby Cron is once per day with ±59-minute timing precision). Transactional notifications do not wait for that sweep: successful staff invite/resend and member-import activation queue actions nudge the authenticated worker after returning the application response. The durable daily sweep covers missed nudges. The worker claims multiple bounded batches (default 100 each, up to ten per invocation) within a 240-second processing budget, so hundreds of activations can drain in one launch nudge when the provider responds normally. Member activation messages remain excluded unless the explicit release variable is exactly `true`. Supplier imports currently do not need continuous polling: the active Active Sports workflow imports synchronously, and no application caller enqueues generic supplier jobs. If queued supplier jobs are introduced, invoke the retained protected worker from an approved scheduler or trusted operator; they will not run automatically in this configuration. The notification endpoint returns 503 before claiming intents if SMTP configuration is incomplete. See [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) for current plan timing limits.

Workers are safe to invoke repeatedly: billing uses durable claims and stable provider idempotency keys; supplier imports use the database claim RPC with `FOR UPDATE SKIP LOCKED`; notifications use the durable outbox and lease claims. Investigate failed responses using protected server logs and durable job/outbox state, not raw provider errors in responses.

## Provider endpoints

- Stripe webhook: `https://the-road-to-12.vercel.app/api/webhooks/stripe`
- GoCardless webhook: `https://the-road-to-12.vercel.app/api/webhooks/gocardless`
- GoCardless redirect callback: `https://the-road-to-12.vercel.app/api/club/join/gocardless/complete`
- Membership billing worker: `GET https://the-road-to-12.vercel.app/api/internal/membership-billing-worker`
- Queued supplier import worker: `GET https://the-road-to-12.vercel.app/api/internal/supplier-import-worker`
- Notification delivery worker: `GET https://the-road-to-12.vercel.app/api/internal/notification-worker`

Vercel Cron supplies the bearer header from `CRON_SECRET`. Trusted manual calls may use the corresponding dedicated worker secret or `CRON_SECRET`; never put a secret in a URL or log.

Stripe Checkout uses the server secret key and does not require a publishable key. Subscribe the Stripe endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`. Copy the endpoint-specific signing secret into `STRIPE_WEBHOOK_SECRET`.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL, explicit GoCardless live mode, SpaceMail SMTP credentials/sender identities, `R12_EMAIL_PROVIDER=smtp`, and a restricted test-recipient allowlist; redeploy through the normal release workflow.
2. Create/verify Stripe live webhook endpoint and selected events; store its signing secret in Vercel. Confirm Stripe is using the intended live account.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Verify `CRON_SECRET` is configured and both daily cron jobs appear in the Vercel dashboard. Before real invitations, review all templates at `/club/staff/email-preview` and send only to an allowlisted internal address. Confirm email delivery state and the daily queue delay are acceptable. Queued supplier imports require a trusted manual/scheduler invocation until automatic polling is deliberately configured.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup, Site URL and redirect allow-list.
6. Open Club → Staff → Preview & test emails as an authorised manager/owner. Verify staff and member templates using an allowlisted internal recipient before issuing invites.
7. Open Club → More → Launch readiness as an authorised owner/admin. It reports configuration presence/format and repository-declared cron schedules, never secret values. It cannot verify a deployed cron is active, provider connectivity, sender-domain authentication, or provider-dashboard setup.

### Supabase Auth redirects

In Supabase Authentication → URL Configuration, set the Site URL to `https://the-road-to-12.vercel.app` and allow the production callback URLs `https://the-road-to-12.vercel.app/account` and `https://the-road-to-12.vercel.app/account/reset`. Add only the required preview/development origins separately if those environments need Auth callbacks. The app constructs confirmation and password-reset redirects from the active application origin. Supabase Auth SMTP is configured separately from application transactional SMTP.

## Notification lease recovery and delivery guarantees

The notification worker claims outbox rows using the existing `FOR UPDATE SKIP LOCKED` RPC and a ten-minute lease. The live `2026-12-08-notification-claim-recovery.sql` migration returns expired `processing` claims to the retry path, clears the stale lease, and records a non-secret diagnostic reason. Attempts remain bounded at three; an expired final attempt is marked failed for review. A live lease and a `sent` intent are never reclaimed, and terminal failed rows are not bypassed. Re-running the same intent preserves its outbox identity/idempotency key.

SMTP acceptance and saving the local `sent` state are two separate systems. If SMTP accepts a message and the worker crashes before the database completion RPC, the lease will eventually be recovered and a duplicate delivery is possible. Ordinary SMTP offers no universal idempotency transaction across that boundary; a stable message identity can aid diagnosis but cannot guarantee exactly-once delivery. Delivery remains bounded and auditable, not exactly once.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Repository code status

- New Madhouse joins use Stripe Checkout subscriptions with signed webhook validation, durable idempotency and provider-order-safe reconciliation. Existing GoCardless arrangements retain their redirect/webhook/collection-worker path and are not migrated or charged again.
- The notification outbox uses the live stale-claim recovery, ten-minute leases, bounded three-attempt recovery, and concurrent-safe database claims.
- Membership billing is scheduled daily at 06:00 UTC in `vercel.json`, compatible with Vercel Hobby. Explicitly queued supplier-import jobs retain a protected worker endpoint but are not automatically polled; the current Active Sports upload runs synchronously. Deployment activation still requires Vercel verification.
- Application transactional SMTP transport is implemented. Delivery remains disabled until server SMTP configuration is complete; the protected worker checks readiness before claiming queued work and is scheduled daily at 06:15 UTC.

## Public app URL while preserving the landing site

The Next.js app's root route is an authenticated app home, not the existing public R12 landing site. Do not point the bare-domain root `/` at this Vercel project or replace the current landing origin. The app can use `https://r12.live` as its canonical origin after Cloudflare routes app paths to the existing Vercel deployment. Keep the landing site as the origin for `/` and its existing marketing paths.

Use a Cloudflare Worker (or equivalent path-aware reverse proxy) on the existing `r12.live` zone. Route only app paths to `https://the-road-to-12.vercel.app`, preserving method, path, query, request body, cookies and response `Set-Cookie` headers. Forward `x-forwarded-host: r12.live` and `x-forwarded-proto: https`; do not cache authenticated pages, `/api/*`, or auth responses. Keep `/` and all current marketing paths on their present landing origin. Route the required `/club*`, `/coach*`, `/member-hub*` (including `/member-hub/link`), `/member-link` (legacy redirect only), `/account*`, `/api/*`, `/training*`, `/nutrition*`, `/progress*`, `/history*`, `/onboarding*`, and both `/join` and `/join/*` (including `/join/madhouse-gym`) app paths, along with `/manifest.webmanifest`, `/club/manifest.webmanifest`, `/r12-app-assets/*`, and app-owned public assets such as `/icons/*`, `/club-branding/*`, and `/product-images/*`. The app-specific icon assets use `/r12-app-assets/*` so the marketing site's existing root favicon and apple-touch icon are not replaced. Compare this allowlist with the landing site's routes and asset paths before activation; resolve any collision explicitly rather than proxying all traffic. Route `/privacy` and `/terms` to the app only if those paths are not existing landing pages. The current app root is intentionally not included.

The proxy must also serve the app's Next static chunks at `/_next/static/*`. If that path is used by the landing site too, use a distinct app asset origin/prefix or a Vercel rewrite arrangement that keeps both builds' chunk URLs isolated; do not blindly route the shared path and risk breaking landing assets. Test Server Actions, Supabase cookie set/refresh, deep links and checkout callbacks through the public hostname before changing provider callbacks.

The browser will see `r12.live`, so host-only Supabase cookies will belong to that host across app paths; do not widen them with `Domain=.r12.live`. Same-origin proxying does not isolate cookies by path, so confirm the landing site's authentication does not collide with R12's Supabase cookie names/session. The PWA starts at `/member-hub`, not the marketing root. Native/app deep links should use the same public app paths once routing is live.

## External setup required

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://r12.live` (preferred canonical app origin, after Cloudflare app-path routing is active). Set `NEXT_PUBLIC_SITE_URL=https://r12.live` as the legacy fallback as well. Until the path proxy and callback allowlist are ready, retain the current Vercel origin rather than switching early.
- `STRIPE_SECRET_KEY` and the endpoint-specific `STRIPE_WEBHOOK_SECRET` for the Madhouse Franchise Limited Stripe account.
- `STRIPE_FRANCHISE_ACCOUNT_ID=acct_...` for that same account. Checkout verifies the secret key's account before creating a session, preventing accidental Products and Services routing.
- `STRIPE_MEMBERSHIP_MODE=test` for an authorised test deployment, or `live` only for the reviewed production deployment. Webhooks fail closed when the event mode differs.
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

- Stripe webhook: `https://r12.live/api/webhooks/stripe` (after `/api/*` is proxied)
- GoCardless webhook: `https://r12.live/api/webhooks/gocardless` (after `/api/*` is proxied)
- GoCardless redirect callback: `https://r12.live/api/club/join/gocardless/complete` (after `/api/*` is proxied)
- Membership billing worker: `GET https://r12.live/api/internal/membership-billing-worker`
- Queued supplier import worker: `GET https://r12.live/api/internal/supplier-import-worker`
- Notification delivery worker: `GET https://r12.live/api/internal/notification-worker`

Vercel Cron supplies the bearer header from `CRON_SECRET`. Trusted manual calls may use the corresponding dedicated worker secret or `CRON_SECRET`; never put a secret in a URL or log.

Stripe Checkout uses the server secret key and does not require a publishable key. The key and webhook endpoint must belong to **Madhouse Franchise Limited**, not the separate Products and Services merchant. PayPal Pay in 3 remains disabled and outside this flow. Subscribe the Stripe endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.updated`, `charge.dispute.created`, and `charge.dispute.closed`. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

The joining page sends server-authoritative one-time and recurring price data to Stripe: the joining fee is a one-time invoice item, while the selected membership price recurs monthly. The browser return only reports that Stripe is processing; only signed events recorded by the database state machine can create membership, entitlement, billing or access state.

### Authorised Stripe test-mode purchase

Before an operator performs a test purchase:

1. Review and apply `2027-01-04-stripe-membership-subscriptions.sql` to the non-production Supabase target using the migration runner. Do not apply it implicitly from an application deployment.
2. Use a non-production deployment whose `STRIPE_SECRET_KEY` is a **test-mode key from Madhouse Franchise Limited**, set `STRIPE_FRANCHISE_ACCOUNT_ID` to that account's `acct_...` ID, set `STRIPE_MEMBERSHIP_MODE=test`, and set `STRIPE_WEBHOOK_SECRET` to the signing secret for that deployment's Stripe test webhook endpoint.
3. Register the test webhook endpoint with the event list above and ensure its URL reaches `/api/webhooks/stripe`. Do not reuse a live endpoint secret.
4. Set `R12_APP_BASE_URL` to the exact HTTPS origin under test, and use a verified R12 test user with no imported/claimed Madhouse membership. Confirm the Rotherham and Carlton locations, membership products and required joining-fee rows exist in the test database.
5. In Stripe test mode, complete Checkout with a Stripe test card. Verify in this order: Checkout shows joining fee + first month due now and the ongoing monthly amount; the browser return alone leaves access inactive; signed `invoice.paid`/Checkout and active-subscription events activate exactly one membership; the next obligation is created for the Stripe billing-period end.
6. Exercise Stripe test clocks or test events for duplicate delivery, `past_due`, failed invoice, recovery, cancellation, full refund and dispute. Confirm the durable event journal prevents replay, stale events do not regress newer state, cancellation respects paid-through time, and refund/dispute adds a payment access suspension without bypassing induction, age or other door rules.

No live charge, Stripe product/price mutation, webhook registration or production migration is part of repository validation.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL, explicit GoCardless live mode, SpaceMail SMTP credentials/sender identities, `R12_EMAIL_PROVIDER=smtp`, and a restricted test-recipient allowlist; redeploy through the normal release workflow.
2. Create/verify the Stripe live webhook endpoint and selected events; store its signing secret in Vercel, set `STRIPE_MEMBERSHIP_MODE=live`, and confirm both credentials are from Madhouse Franchise Limited.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Verify `CRON_SECRET` is configured and both daily cron jobs appear in the Vercel dashboard. Before real invitations, review all templates at `/club/staff/email-preview` and send only to an allowlisted internal address. Confirm email delivery state and the daily queue delay are acceptable. Queued supplier imports require a trusted manual/scheduler invocation until automatic polling is deliberately configured.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup, Site URL and redirect allow-list.
6. Open Club → Staff → Preview & test emails as an authorised manager/owner. Verify staff and member templates using an allowlisted internal recipient before issuing invites.
7. Open Club → More → Launch readiness as an authorised owner/admin. It reports configuration presence/format and repository-declared cron schedules, never secret values. It cannot verify a deployed cron is active, provider connectivity, sender-domain authentication, or provider-dashboard setup.

### Supabase Auth redirects

In Supabase Authentication → URL Configuration, once path routing is active, set the Site URL to `https://r12.live` and allow the production callback URLs `https://r12.live/account` and `https://r12.live/account/reset` (plus any specific existing claim callback that is configured to receive Auth redirects). Keep preview/development origins separate. Browser signup/reset redirects derive from the current app origin, so using the app at `r12.live` sends those callbacks back to `r12.live`. Supabase Auth SMTP is configured separately from application transactional SMTP.

## Notification lease recovery and delivery guarantees

The notification worker claims outbox rows using the existing `FOR UPDATE SKIP LOCKED` RPC and a ten-minute lease. The live `2026-12-08-notification-claim-recovery.sql` migration returns expired `processing` claims to the retry path, clears the stale lease, and records a non-secret diagnostic reason. Attempts remain bounded at three; an expired final attempt is marked failed for review. A live lease and a `sent` intent are never reclaimed, and terminal failed rows are not bypassed. Re-running the same intent preserves its outbox identity/idempotency key.

SMTP acceptance and saving the local `sent` state are two separate systems. If SMTP accepts a message and the worker crashes before the database completion RPC, the lease will eventually be recovered and a duplicate delivery is possible. Ordinary SMTP offers no universal idempotency transaction across that boundary; a stable message identity can aid diagnosis but cannot guarantee exactly-once delivery. Delivery remains bounded and auditable, not exactly once.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Repository code status

- New Madhouse joins use Stripe Checkout subscriptions with signed webhook validation, durable idempotency and provider-order-safe reconciliation. Existing GoCardless arrangements retain their redirect/webhook/collection-worker path and are not migrated or charged again.
- The notification outbox uses the live stale-claim recovery, ten-minute leases, bounded three-attempt recovery, and concurrent-safe database claims.
- Membership billing is scheduled daily at 06:00 UTC in `vercel.json`, compatible with Vercel Hobby. Explicitly queued supplier-import jobs retain a protected worker endpoint but are not automatically polled; the current Active Sports upload runs synchronously. Deployment activation still requires Vercel verification.
- Application transactional SMTP transport is implemented. Delivery remains disabled until server SMTP configuration is complete; the protected worker checks readiness before claiming queued work and is scheduled daily at 06:15 UTC.

## Public app URL while preserving the landing site

The Next.js app uses the dedicated Vercel domain `https://app.r12.live`. The public marketing site keeps the bare `r12.live` host. Production callbacks, notification links and webhook destinations must use `https://app.r12.live`; do not use the Vercel project hostname or the bare marketing domain.

The app's Vercel project reports `app.r12.live` as a verified project domain. Confirm the Vercel domain remains assigned to the production project and that its DNS points to Vercel. The app root and authenticated routes remain on the app subdomain, so no path proxy or shared landing-site cookie routing is required.

## External setup required

### Restricted-key merchant binding approval

Stripe documents HTTP 403 as an authenticated key lacking permission, and HTTP 401 as no valid API key. The current `GET /v1/account` result therefore confirms key authentication but only that self-account reading is denied. Stripe's documented `GET /v1/accounts/:id` is a Connect account operation, so R12 does not use it for merchant identity.

For each merchant, the account owner must independently sign into the correct Stripe Dashboard account and check the account ID plus the legal business name and Companies House number (Franchise: 17383077; Products and Services: 17383213). Confirm which restricted key was created in that account and installed in the matching Vercel variable. The privileged Club diagnostic exposes only a SHA-256 fingerprint of the installed key, not the key. Record the independent Dashboard check in an internal approval/ticket and use its reference in the binding record. The offline Ed25519 signing key must be held separately from Vercel; its private half must never be uploaded or committed.

Generate one Ed25519 key pair on a secured owner workstation (keep the private key offline and backed up securely), then add only the public PEM as `STRIPE_ACCOUNT_BINDING_PUBLIC_KEY` in Vercel Production. Visit Club → Launch readiness → Stripe using an authorised owner account and note the fingerprint for each merchant. Create one JSON file per entity, filling values from the Dashboard and the privileged diagnostic:

```sh
umask 077
mkdir -p "$HOME/.config/r12"
openssl genpkey -algorithm ED25519 -out "$HOME/.config/r12/stripe-binding-private.pem"
openssl pkey -in "$HOME/.config/r12/stripe-binding-private.pem" -pubout -out "$HOME/.config/r12/stripe-binding-public.pem"
```

Upload only `stripe-binding-public.pem` as the Vercel variable. Keep `stripe-binding-private.pem` offline. Do not regenerate this pair for each approval; losing the private key requires a separately controlled public-key rotation and new signed bindings.

```json
{
  "version": 1,
  "entity": "madhouse_franchise",
  "accountId": "acct_REPLACE_WITH_DASHBOARD_ID",
  "legalEntityNumber": "17383077",
  "legalEntityName": "Madhouse Franchise Limited",
  "apiKeyFingerprint": "REPLACE_WITH_64_CHARACTER_SHA256_FINGERPRINT",
  "approvedAt": "2026-10-22T12:00:00.000Z",
  "approvedBy": "Owner name or controlled staff identity",
  "evidenceReference": "internal-approval-ticket-reference"
}
```

For Products and Services, set `entity` to `madhouse_products_services`, `accountId` and the fingerprint to that merchant's values, `legalEntityNumber` to `17383213`, and `legalEntityName` to `Madhouse Products and Services Limited`. Use a distinct internal evidence reference for each record. Sign each JSON record offline with `node scripts/sign-stripe-account-binding.mjs <entity> <binding.json> <offline-private-key.pem>`. Store the exact JSON in the corresponding `STRIPE_FRANCHISE_ACCOUNT_BINDING` / `STRIPE_PRODUCTS_SERVICES_ACCOUNT_BINDING` server-side Vercel variable and the returned signature in the corresponding `_ACCOUNT_BINDING_SIGNATURE` variable. Keep the approval JSON and signature in the controlled internal approval record. Never place the private key in Vercel, source control, chat or logs.

After Vercel has a new production deployment with those settings, rerun `/club/launch-readiness/stripe`. It must show `accountBinding=verified`, `keyAuthentication=accepted`, and distinct account IDs for both entities. The current `403 more_permissions_required` for `/v1/account` is shown separately as `selfAccountRead=permission_denied`; this is expected under these restricted scopes. `checkoutPermission=not_tested` remains honest until a separately authorised Checkout test. Keep both live gates off; this binding procedure does not activate payments.

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://app.r12.live` (preferred canonical app origin). Set `NEXT_PUBLIC_SITE_URL=https://app.r12.live` as the legacy fallback as well. Production URL resolution pins callbacks to this host and reports a mismatched configured origin.
- Franchise membership payments use `STRIPE_FRANCHISE_SECRET_KEY`, `STRIPE_FRANCHISE_WEBHOOK_SECRET`, `STRIPE_FRANCHISE_ACCOUNT_ID=acct_...`, and `STRIPE_FRANCHISE_MODE=test|live`; all four values belong to Madhouse Franchise Limited (17383077).
- Supported one-off shop/service purchases use the separate `STRIPE_PRODUCTS_SERVICES_SECRET_KEY`, `STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET`, `STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID=acct_...`, and `STRIPE_PRODUCTS_SERVICES_MODE=test|live`; all four belong to Madhouse Products and Services Limited (17383213). There is no generic Stripe key fallback.
- Live Checkout verifies a signed, operator-approved account binding that includes the configured account ID, legal entity number/name, and SHA-256 fingerprint of that exact installed API key. This is required because Stripe returns `403 more_permissions_required` for `GET /v1/account` with the current restricted keys and Accounts: Read is not available in the key UI. Do not substitute Connect's `GET /v1/accounts/:id`, trust the account-ID setting by itself, or remove the binding check. Test-mode checkout continues to use the read-only self-account identity check. Product ownership and exact Stripe Product/Price IDs must be explicitly configured in the catalogue; categories and gym sites never infer a merchant.
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

- Madhouse Franchise Stripe webhook: `https://app.r12.live/api/webhooks/stripe`
- Madhouse Products & Services Stripe webhook: `https://app.r12.live/api/webhooks/stripe/products-services`
- Products & Services class Stripe webhook: `https://app.r12.live/api/webhooks/stripe/classes` (separate endpoint signing secret, same merchant account)
- GoCardless webhook: `https://app.r12.live/api/webhooks/gocardless`
- GoCardless redirect callback: `https://app.r12.live/api/club/join/gocardless/complete`
- Membership billing worker: `GET https://app.r12.live/api/internal/membership-billing-worker`
- Queued supplier import worker: `GET https://app.r12.live/api/internal/supplier-import-worker`
- Notification delivery worker: `GET https://app.r12.live/api/internal/notification-worker`

These are the exact application destinations to configure in the corresponding provider dashboards. Dashboard endpoint registrations and signing-secret associations must be checked by an authorised account owner; this repository and its readiness page cannot read those dashboard settings.

Vercel Cron supplies the bearer header from `CRON_SECRET`. Trusted manual calls may use the corresponding dedicated worker secret or `CRON_SECRET`; never put a secret in a URL or log.

Stripe Dashboard setup is separate for each legal entity and for test/live mode. Create independent API credentials and endpoint signing secrets; never copy a key, customer, Product, Price, or endpoint secret between accounts. The Franchise endpoint at `/api/webhooks/stripe` subscribes to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.updated`, `charge.dispute.created`, and `charge.dispute.closed`. Use the Franchise-only four environment variables above.

The Products & Services endpoint at `/api/webhooks/stripe/products-services` subscribes to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`. Use its Products & Services-only four environment variables. The online shop currently offers card checkout only for a basket whose every product is explicitly routed to that entity with matching active Stripe Product/Price references and an undiscounted server-calculated total. Balance split, Klarna, Clearpay and PayPal remain unavailable on this provider path. PT and Glow Zone ownership must be confirmed before routing those services; ambiguous ownership fails closed. The existing PayPal Pay in 3 Franchise settlement arrangement for eligible transformation packages and restricted Golden Ticket sales is unchanged and remains disabled.

Madhouse has one cross-site membership plan catalogue: every eligible plan includes Rotherham and Carlton access. The optional home-gym choice is stored only as a preference; it does not change the plan, price, Stripe customer/account, subscription or gym entitlement scope. The joining fee is a one-time Checkout line item alongside the first recurring membership charge; the monthly membership price then recurs at its configured Stripe billing period. The success URL only says payment is processing. Signed events are bound to the Franchise Stripe account and exact request/session/customer/subscription before the durable database state machine can activate membership. Existing Club Manager, GoCardless and cash imports are not charged or recreated. Age, induction, suspension and door-safety checks remain independent of payment.

### Authorised Stripe test-mode purchase

Before an operator performs a test purchase:

1. Review and apply `2027-01-11-stripe-membership-subscriptions.sql` and `2027-01-12-two-stripe-merchant-isolation.sql` to a non-production Supabase target using the migration runner. Do not apply them implicitly from an application deployment.
2. Create/verify both test-mode Stripe accounts. In the non-production deployment set the four Franchise variables and four Products & Services variables to their respective test accounts and endpoint secrets; never use a client account selector.
3. Register both test endpoints using the distinct event lists above. Verify that each key resolves through the Stripe API to its configured `acct_...` account and that each endpoint's signature is accepted only by its matching route.
4. Confirm one cross-site Madhouse membership plan and its joining-fee values in R12. Checkout creates account-scoped Stripe Price data from the server-verified R12 amounts; no Stripe plan Price ID is accepted from the browser. Use a verified R12 test identity with no imported/claimed membership and optionally select either home gym (or no preference).
5. Complete one test Checkout with a Stripe test card. Verify: joining fee + first membership period are due now; the monthly recurring amount and interval are shown; both locations are included; the browser return alone leaves access inactive; only correctly signed Franchise events bound to the stored account/session/customer/subscription create exactly one membership; the next billing obligation matches Stripe's invoice period. Repeat with home gym blank and the other location and confirm identical price/subscription and org-wide gym entitlement.
6. In the Products & Services test account configure one confirmed shop Product and active Price in catalogue, then test a one-off card purchase; verify the merchant account, customer, amount, order and payment all reconcile only to Products & Services. Do not route PT/Glow Zone until the merchant-of-record decision is documented.
7. Exercise duplicate and out-of-order webhook deliveries, failed/pending payment, subscription `past_due`/recovery/cancellation, full refund and dispute using Stripe test tools/test clocks. Verify idempotency and that age, induction, suspension and safety rules remain enforced at both gyms.

No live charge, Stripe product/price mutation, webhook registration or production migration is part of repository validation. These steps require an explicitly authorised test-mode purchase and non-production credentials. Class checkout uses its own endpoint signing secret under `STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET`; keep live class checkout disabled until separately approved.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL, explicit GoCardless live mode, SpaceMail SMTP credentials/sender identities, `R12_EMAIL_PROVIDER=smtp`, and a restricted test-recipient allowlist; redeploy through the normal release workflow.
2. Create/verify separate Stripe live keys and endpoints for both legal entities, store each endpoint's signing secret in its matching Vercel variables, and confirm each key via API is the configured entity's account before any sales are enabled.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Verify `CRON_SECRET` is configured and both daily cron jobs appear in the Vercel dashboard. Before real invitations, review all templates at `/club/staff/email-preview` and send only to an allowlisted internal address. Confirm email delivery state and the daily queue delay are acceptable. Queued supplier imports require a trusted manual/scheduler invocation until automatic polling is deliberately configured.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup, Site URL and redirect allow-list.
6. Open Club → Staff → Preview & test emails as an authorised manager/owner. Verify staff and member templates using an allowlisted internal recipient before issuing invites.
7. Open Club → More → Launch readiness as an authorised owner/admin. It reports configuration presence/format and repository-declared cron schedules, never secret values. It cannot verify a deployed cron is active, provider connectivity, sender-domain authentication, or provider-dashboard setup.

### Supabase Auth redirects

In Supabase Authentication → URL Configuration, set the Site URL to `https://app.r12.live` and allow the production callback URLs `https://app.r12.live/account` and `https://app.r12.live/account/reset` (plus any specific existing claim callback that is configured to receive Auth redirects). Keep preview/development origins separate. Browser signup/reset redirects derive from the current app origin, so callbacks return to the app subdomain. Supabase Auth SMTP is configured separately from application transactional SMTP.

## Notification lease recovery and delivery guarantees

The notification worker claims outbox rows using the existing `FOR UPDATE SKIP LOCKED` RPC and a ten-minute lease. The live `2026-12-08-notification-claim-recovery.sql` migration returns expired `processing` claims to the retry path, clears the stale lease, and records a non-secret diagnostic reason. Attempts remain bounded at three; an expired final attempt is marked failed for review. A live lease and a `sent` intent are never reclaimed, and terminal failed rows are not bypassed. Re-running the same intent preserves its outbox identity/idempotency key.

SMTP acceptance and saving the local `sent` state are two separate systems. If SMTP accepts a message and the worker crashes before the database completion RPC, the lease will eventually be recovered and a duplicate delivery is possible. Ordinary SMTP offers no universal idempotency transaction across that boundary; a stable message identity can aid diagnosis but cannot guarantee exactly-once delivery. Delivery remains bounded and auditable, not exactly once.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

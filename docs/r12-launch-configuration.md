# R12 production launch configuration

Use this as the Vercel/provider-dashboard checklist. Never put secret values in source control, client-visible variables, screenshots, or support tickets.

## Vercel production environment

Set the following server-side values in the Production environment:

- `R12_APP_BASE_URL=https://the-road-to-12.vercel.app` (preferred canonical app origin). `NEXT_PUBLIC_SITE_URL` is a legacy fallback; neither may point at `r12.live`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, and `GOCARDLESS_ENVIRONMENT=live` after the live provider setup is verified. The integration defaults to sandbox if the environment is omitted; set it explicitly.
- `R12_BILLING_WORKER_SECRET` and `R12_NOTIFICATION_WORKER_SECRET`. `CRON_SECRET` is supported as a fallback, but dedicated secrets are preferred.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for protected server workers. Keep the service-role key server-only.

Email sender identities are configurable without changing templates:
`R12_EMAIL_FROM_MEMBERS=members@r12.live`,
`R12_EMAIL_FROM_STAFF=staff@r12.live`, and
`R12_EMAIL_FROM_BILLING=madhouse.accounts@r12.live`.
Supabase Auth confirmation/reset mail is separate: configure its SMTP sender as `members@r12.live` in Supabase Auth settings.

Important: the repository currently has no real transactional email transport. Setting `R12_EMAIL_PROVIDER` to `smtp` does not enable delivery; it reports unavailable until an adapter is implemented. `mock` is test-only. In-app notification state remains authoritative and email intents remain visibly unavailable rather than falsely succeeding.

## Provider endpoints

- Stripe webhook: `https://the-road-to-12.vercel.app/api/webhooks/stripe`
- GoCardless webhook: `https://the-road-to-12.vercel.app/api/webhooks/gocardless`
- GoCardless redirect callback: `https://the-road-to-12.vercel.app/api/club/join/gocardless/complete`
- Membership billing worker: `GET https://the-road-to-12.vercel.app/api/internal/membership-billing-worker` with `Authorization: Bearer <R12_BILLING_WORKER_SECRET>`
- Notification delivery worker: `GET https://the-road-to-12.vercel.app/api/internal/notification-worker` with `Authorization: Bearer <R12_NOTIFICATION_WORKER_SECRET>`

Run the billing worker hourly (`0 * * * *`) using a trusted scheduler and the bearer header. Configure the notification worker only when operationally useful; without a real email adapter it will mark queued outbound intents unavailable, not send email.

Stripe Checkout uses the server secret key and does not require a publishable key. Subscribe the Stripe endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`. Copy the endpoint-specific signing secret into `STRIPE_WEBHOOK_SECRET`.

Configure GoCardless webhook events for mandate and payment lifecycle changes used by the integration. Copy the webhook secret for the selected environment into `GOCARDLESS_WEBHOOK_SECRET`; sandbox and live have separate credentials and webhook endpoints/configuration.

## Sandbox-to-live checklist

1. Configure production Vercel variables, including the canonical app URL and explicit GoCardless live mode; redeploy through the normal release workflow.
2. Create/verify Stripe live webhook endpoint and selected events; store its signing secret in Vercel. Confirm Stripe is using the intended live account.
3. Create/verify the GoCardless live access token and live webhook endpoint; store both secrets and explicitly set `GOCARDLESS_ENVIRONMENT=live`.
4. Configure the hourly billing worker scheduler and protect it with the dedicated bearer secret. Verify worker responses/logs without triggering real collection runs outside the approved operational test plan.
5. Configure Supabase Auth SMTP separately with the approved sender/domain setup. Transactional application email remains unavailable until a real adapter is selected and implemented.
6. Open Club → More → Launch readiness as an authorised owner/admin. It reports presence/format only, never secret values, and cannot verify provider-dashboard setup or credentials remotely.

Provider webhook signing, webhook delivery, bank mandates, SMTP deliverability, and scheduler execution must be verified in their respective dashboards. The readiness screen is a configuration-presence check, not proof of live provider connectivity.

# Madhouse Apparel checkout and order operations

This is a staged implementation. Live payments remain guarded by the existing
Products & Services merchant policy and `STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED`.
The public checkout handoff is signed server-to-server; never place its secret
or Stripe/Supabase service credentials in browser variables.

## Database release

Review and apply `supabase/migrations/2026-11-04-madhouse-apparel-orders.sql`
in Supabase SQL Editor only after confirming these existing production objects
are present: the Website Shop controls tables/RPC, commerce order and payment
tables, Stripe commerce reconciliation functions, Madhouse product families,
and `club_evaluate_commerce_promotions` bundle configuration. The migration is
additive and must be applied once through the normal release record. Do not
rerun the earlier Website Shop migration.

The SQL creates guest order details, fulfilment history and email outbox data
around the existing `club_orders`, `club_order_items`, `club_payment_attempts`,
and `club_payments` records. Its checkout RPC is `service_role` only. It checks
publication, family visibility, active product variants, allowed sizes and the
current website price again on the server. Promotion eligibility is derived
from the active R12 hoodie/T-shirt bundle configuration; if that configuration
or its configured price does not agree with the current website prices, the
checkout RPC rejects the basket safely.

Website apparel order items are recorded as made-to-order (`stock_tracked=false`).
The migration also preserves R12 supplier-demand handling for existing Club
orders while excluding only the website-apparel snapshot rows from supplier
collection demand generation.

## Application configuration required

Set these server-only values on the indicated Vercel projects, with the same
high-entropy secret in both projects:

- R12 Club: `R12_APPAREL_CHECKOUT_HMAC_SECRET` (at least 32 bytes) and
  `MADHOUSE_APPAREL_SITE_URL=https://madhousegym.online`.
- Madhouse website: the same `R12_APPAREL_CHECKOUT_HMAC_SECRET` and
  `R12_APPAREL_CHECKOUT_URL=https://app.r12.live/api/public/madhouse-apparel/checkout`.

None of these may use a `NEXT_PUBLIC_` prefix. The site URL is validated by
the R12 checkout service; the endpoint URL is used only by the website server.

The public website already uses its R12 anon key only for the narrow public
catalogue and confirmation RPCs. It does not need or receive the Supabase
service-role key.

Before live checkout can start, Keenan must verify the Products & Services
Stripe account binding and webhook endpoint end to end, then deliberately set
`STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED=true` on the R12 project. The existing
Stripe checkout code also validates the merchant account and rejects a
franchise route. No live setting is enabled by this change.

## Email readiness

Order and fulfilment templates are rendered by the authenticated R12
notification worker. Set the following only after the sender has been verified
for `madhousegym.online` and actual recipients have been approved:

- `MADHOUSE_APPAREL_EMAIL_FROM` — verified address at `madhousegym.online`.
- `MADHOUSE_APPAREL_EMAIL_FROM_NAME` — normally `Madhouse Apparel`.
- `MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED=true` — explicit operator gate after verification.
- `MADHOUSE_APPAREL_ORDER_RECIPIENTS` — comma-separated confirmed manager recipients, including Keenan.

SMTP continues to use R12's server-only provider settings. Without the sender
verification flag, Apparel email outbox rows remain queued and are not sent.
Without manager recipients, R12 Club's new-order events and order count still
appear, but email escalation to managers is not configured.

## Rollout order

1. Review and apply the additive SQL migration in production; verify the
   Website Shop products RPC still returns only published rows.
2. Deploy R12 Club code and the R12 server-only HMAC setting.
3. Deploy the Madhouse website code and its endpoint, origin, and matching HMAC
   settings.
4. Exercise Stripe test mode and signed webhook events against the Products &
   Services merchant; verify one paid order, one Club alert, idempotent webhook
   retry, and the order confirmation lookup.
5. Verify the Apparel sender domain and recipients; test all lifecycle emails.
6. Enable live checkout only after the payment routing and order reconciliation
   have passed those checks.

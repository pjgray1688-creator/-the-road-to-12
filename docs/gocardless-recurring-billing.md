# GoCardless recurring membership billing

This worker collects due monthly Madhouse membership obligations after the paid joining flow has established an active GoCardless mandate. It does not activate memberships and it never calculates amounts from a browser request.

## Required server configuration

- `GOCARDLESS_ACCESS_TOKEN`
- `GOCARDLESS_WEBHOOK_SECRET`
- `GOCARDLESS_ENVIRONMENT` (`sandbox` or `live`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `R12_BILLING_WORKER_SECRET` (or the existing `CRON_SECRET` fallback)

All of these values are server-only. The worker fails before claiming work when GoCardless is not configured.

## Scheduler

Invoke `GET /api/internal/membership-billing-worker` with `Authorization: Bearer <R12_BILLING_WORKER_SECRET>` once per hour. An hourly schedule such as `0 * * * *` is intentionally more frequent than the monthly obligations; the database claim and the stable GoCardless idempotency key make repeated runs safe. Configure this in Vercel only after the migration and secrets have been reviewed and applied. No schedule is added by this repository change.

The route processes at most 25 due obligations per invocation. One rejected member collection does not stop the remainder of the batch. Ambiguous network/provider failures retain the claim for 15 minutes, then resume with the same logical obligation and provider idempotency key.

## Provider webhook

Register the existing signed endpoint as the GoCardless webhook URL:

`POST /api/webhooks/gocardless`

Enable payment and mandate events. Payment events reconcile pending, confirmed/paid, failed, cancelled, charged-back and provider-retry states. Mandate failed, cancelled, expired or replaced events block new collections and expose an action-required state; the existing hosted mandate flow provides the replacement path.

The migration for this worker is `supabase/migrations/2026-12-02-gocardless-recurring-collections.sql`. It must be applied deliberately before enabling the scheduler. Do not point local tests at a real GoCardless environment.

# Madhouse classes release procedure

This change is not approved for production. Validate it on a disposable PostgreSQL baseline and review the production preflight before selecting one migration path.

## Test database gate

Prepare a disposable `r12_ci` PostgreSQL baseline containing the repository's applied prerequisite schema. Do not point `PGDATABASE` or `R12_DATABASE_URL` at production for validation. Run:

```sh
PGDATABASE=r12_ci scripts/validate-coach-nutrition-reconciliation-postgres.sh
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

The PostgreSQL harness reruns the idempotent Madhouse operating, station, credit, daily-check and class-payment migrations, then runs `tests/sql/madhouse-weekly-operations-import.sql` in a transaction that rolls back. Review migration order and all timetable, rota, Sunday-hours, cash and payment contract assertions in the fixture output. The baseline database itself must be disposable.

## Preflight and backup

1. Confirm the approved change set and inspect the current production `r12_schema_migrations` names and checksums read-only. Resolve any missing baseline or checksum mismatch before proceeding.
2. Take and verify a protected custom-format backup using the approved production connection. Keep the file outside this repository and restrict it to the database operators:

   ```sh
   pg_dump --format=custom --no-owner --no-privileges --file="$BACKUP_FILE" "$R12_DATABASE_URL"
   pg_restore --list "$BACKUP_FILE" >/dev/null
   ```

3. Confirm the application has `STRIPE_PRODUCTS_SERVICES_SECRET_KEY` set to the Products & Services **test** key and `STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET` set to the signing secret for `/api/webhooks/stripe/classes`. Keep `STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED` unset or `false`. Franchise joining uses its independent `STRIPE_FRANCHISE_SECRET_KEY` and `STRIPE_FRANCHISE_WEBHOOK_SECRET`; do not use legacy shared Stripe variables. Configure the class endpoint for checkout completion, asynchronous payment success/failure, and expiration.
4. Read-only preflight must confirm exactly one active Madhouse row for each configured instructor and location alias, and inspect registered station-to-site bindings. Do not seed schedules, rota, daily checks or station rows until those identities are reviewed.
5. Schedule a maintenance window. Class booking will be unavailable while schema changes and application release are coordinated.

## Select one apply path after explicit approval

The production Supabase project and its applied migration ledger are not linked in this worktree. Read the target's `r12_schema_migrations` rows, checksums, and relevant object definitions before choosing a path. Do not infer pending migrations from the filename date or from the November bundle marker alone.

- For a target already at the November 22 final-state baseline with class migrations 04–09 absent, use the ordered [2027-01-04 Madhouse class forward bundle](../../supabase/deployment/2027-01-04-madhouse-class-booking-forward.sql) once in Supabase SQL Editor. It records each original migration checksum in the migration ledger.
- For a target whose complete prerequisite migration history is correctly recorded, use the repository runner below. The runner applies all pending entries in the full manifest, not just Madhouse classes.
- Never run both paths for the same pending 2027 migrations. Stop if ledger state is ambiguous or checksums differ.

The forward chain is not a schema-only change. Migration 2027-01-05 reconciles Madhouse membership product class entitlements and materializes the confirmed weekly included-class grant for existing active transformation holders that do not already have one. It also upserts the class/rota/Glow Zone templates and £10/inactive-add-on configuration. It does not replace existing class bookings or approved shifts. Review the affected product definitions and expected grant count before approving application.

## Products & Services Stripe test setup

1. In Stripe Dashboard, select the Products & Services account and enable test data. Create a test-mode webhook for the approved preview or test application URL at `/api/webhooks/stripe/classes` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`.
2. Store that account's `sk_test_` key as `STRIPE_PRODUCTS_SERVICES_SECRET_KEY`; store the endpoint's `whsec_` signing secret as `STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET`. Use the deployment's secret manager, never source files, command output or client-visible variables. Do not set `STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED`.
3. Complete a £10 class checkout with Stripe's documented test payment data. Confirm the Checkout Session is shown under Products & Services, the signed event delivery is successful, and the booking changes only after the webhook. Separately test a declined attempt and an abandoned/expired session, then redeliver a webhook from the Dashboard to verify duplicate delivery is harmless. Inspect only synthetic booking/payment rows.
4. Keep the Franchise account's `STRIPE_FRANCHISE_SECRET_KEY` and `STRIPE_FRANCHISE_WEBHOOK_SECRET` separate. Do not enable live Checkout or use live payment data until the account owner verifies each account and its product routing.

For the runner path, set `R12_DATABASE_URL` in a protected operator shell without putting credentials in command history, then run:

```sh
scripts/apply-madhouse-schema.sh
```

The runner checks migration files and checksums, applies the ordered manifest and records each completed migration. Stop immediately on any checksum or SQL failure. Do not manually skip a migration or edit its recorded checksum.

After the schema succeeds, review the class/rota import's effect on existing transformation entitlement definitions and active grants. Then perform manager-authorized, audited setup through the application against reviewed real identities: generate only future class sessions and rota dates, seed daily checks, then verify generated sessions, shifts, task locations, Sunday Glow Zone closure and station location bindings. Configure/verify the Products & Services test webhook before enabling member PAYG. Keep live Stripe disabled.

## Recovery

These migrations are additive or replace guarded functions and have no automatic destructive down migration. On a failure, stop application release, capture the error and migration ledger, and use a reviewed forward correction. Restore the protected backup or use point-in-time recovery only when the database owner approves and the post-backup write impact is understood. Never restore production data over the current database as a routine rollback.

Live card payment enablement and any production database execution require separate explicit approval after test database, backup, identity and webhook checks pass.

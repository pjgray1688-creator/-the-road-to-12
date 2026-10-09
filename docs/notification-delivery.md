# R12 transactional notification delivery

Business workflows queue durable `club_member_notification_intents`; the worker claims them with a database lock and records delivery state. The worker never changes membership, payment, access, staff, or Coach authority.

Server-only configuration:

- `R12_EMAIL_PROVIDER=smtp` selects SMTP when the maintained transport is included in the deployed build. `mock` is test-only; missing configuration or transport is truthfully `unavailable`.
- `R12_APP_BASE_URL` (preferred), then `NEXT_PUBLIC_SITE_URL`, for links in messages. Production should use `https://the-road-to-12.vercel.app`; `r12.live` is the landing domain and is rejected for app links. See [the launch configuration checklist](r12-launch-configuration.md).
- `R12_EMAIL_FROM_MEMBERS` (default `members@r12.live`)
- `R12_EMAIL_FROM_BILLING` (default `madhouse.accounts@r12.live`)
- `R12_EMAIL_FROM_STAFF` (default `staff@r12.live`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, and `SMTP_PASSWORD` are server-only settings. Use explicit implicit-TLS (`true`, normally port 465) or required STARTTLS (`false`, commonly port 587); plaintext downgrade is not allowed. Username/password must be paired. No credentials belong in source control or browser code. This checkout currently lacks the Nodemailer dependency and SMTP adapter, so SMTP delivery remains unavailable.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects `GET /api/internal/notification-worker`.

Supabase Auth remains responsible for confirmation and password-reset messages and uses its separately configured SMTP settings. R12 never stores or sends passwords and has no arbitrary-recipient send endpoint. Configure Vercel Cron or another trusted scheduler to call the worker only after a real transport is present. Use `mock` only in a test/sandbox environment.

The worker claims with a ten-minute lease using `FOR UPDATE SKIP LOCKED`. The unapplied 2026-12-08 claim-recovery migration will, once applied through the normal workflow, requeue expired in-flight claims up to the existing three-attempt ceiling and record a safe diagnostic code. Live leases and sent rows are not reclaimed. SMTP acceptance followed by a lost local completion write can cause a later retry and duplicate mail: standard SMTP cannot atomically commit delivery and the database outbox.

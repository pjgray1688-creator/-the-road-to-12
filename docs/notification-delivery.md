# R12 transactional notification delivery

Business workflows queue durable `club_member_notification_intents`; the worker claims them with a database lock and records delivery state. The worker never changes membership, payment, access, staff, or Coach authority.

Server-only configuration:

- `R12_EMAIL_PROVIDER=mock` for local tests, or a future provider name. Missing/unknown configuration is truthful `unavailable`.
- `R12_APP_BASE_URL` for links in messages.
- `R12_EMAIL_FROM_MEMBERS` (default `members@r12.live`)
- `R12_EMAIL_FROM_BILLING` (default `madhouse.accounts@r12.live`)
- `R12_EMAIL_FROM_STAFF` (default `staff@r12.live`)
- `R12_SMTP_HOST`, `R12_SMTP_PORT`, `R12_SMTP_USERNAME`, `R12_SMTP_PASSWORD` are reserved server-only SMTP settings; no credentials belong in the repository or browser bundle.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects `GET /api/internal/notification-worker`.

Supabase Auth remains responsible for confirmation and password-reset messages. R12 never stores or sends passwords and has no arbitrary-recipient send endpoint. Configure Vercel Cron or another trusted scheduler to call the worker later. Use `mock` only in a test/sandbox environment; this pass does not send real email.


# R12 transactional notification delivery

Business workflows queue durable `club_member_notification_intents`; the worker claims them with a database lock and records delivery state. The worker never changes membership, payment, access, staff, or Coach authority.

Server-only configuration:

- `R12_EMAIL_PROVIDER=smtp` selects the built-in Node SMTP transport. `mock` is test-only; missing or invalid configuration fails closed before an outbox intent is claimed.
- `R12_APP_BASE_URL` (preferred), then `NEXT_PUBLIC_SITE_URL`, for links in messages. Production should use `https://the-road-to-12.vercel.app`; `r12.live` is the landing domain and is rejected for app links. See [the launch configuration checklist](r12-launch-configuration.md).
- `R12_EMAIL_FROM_MEMBERS` (default `members@r12.live`)
- `R12_EMAIL_FROM_BILLING` (default `madhouse.accounts@r12.live`)
- `R12_EMAIL_FROM_STAFF` (default `staff@r12.live`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, and `SMTP_PASSWORD` are required server-only settings. Use explicit implicit-TLS (`true`, normally port 465) or required STARTTLS (`false`, commonly port 587); plaintext downgrade is not allowed. No credentials belong in source control or browser code.
- `R12_EMAIL_FROM_STAFF` and `R12_EMAIL_FROM_MEMBERS` set the respective sender addresses; optional `R12_EMAIL_FROM_NAME_STAFF`, `R12_EMAIL_FROM_NAME_MEMBERS`, and `R12_EMAIL_FROM_NAME_BILLING` set display names. Configure only SpaceMail values supplied by the account owner; this repository contains no provider credentials.
- `R12_EMAIL_TEST_RECIPIENTS` is a comma-separated server-side allowlist for the Manager/Owner test-send screen at `/club/staff/email-preview`. Test messages are marked `[TEST]`; this screen never creates grants or outbox rows.
- `R12_MEMBER_ACTIVATION_EMAILS_ENABLED=true` is the explicit release gate for bulk member activation delivery. It is off unless set to exactly `true`; imported activation intents remain queued while staff invitations and other notifications can still deliver.
- `R12_NOTIFICATION_WORKER_SECRET` (or the existing `CRON_SECRET`) protects `GET /api/internal/notification-worker`.
- `R12_NOTIFICATION_BATCH_SIZE` (default `100`, maximum `100`) sets each bounded claim size. `R12_NOTIFICATION_MAX_BATCHES_PER_RUN` (default `10`, maximum `10`) caps a run at ten batches / 1,000 claimed messages. The worker also stops starting batches at its 240-second work budget and scales the next claim to the remaining time; each SMTP delivery has a 20-second hard deadline.

Staff invitations, staff resends, explicitly resent member activations, and newly queued import activations nudge the existing authenticated notification worker using Next.js `after()` after the application response is sent. SMTP never runs inline in the browser request. The worker still claims and completes messages exclusively through the normal outbox RPCs. Vercel Cron remains a daily 06:15 UTC safety-net sweep, compatible with the current Hobby once-daily cron assumption; an immediate nudge is the normal delivery trigger. If no dedicated worker secret or `CRON_SECRET` is configured, the nudge is skipped and the daily cron remains the fallback.

One worker invocation processes bounded batches with at most ten concurrent SMTP sends, a hard 240-second processing budget, and a hard cap of 1,000 claimed messages. Batch size and batch count are configurable only downward from their defaults (`100` and `10`); invalid values fall back to the safe defaults. This supports launch imports of hundreds of members in one nudge without a fixed 100-per-day ceiling. Member activation messages remain excluded from claims until `R12_MEMBER_ACTIVATION_EMAILS_ENABLED=true`, preventing SMTP setup or staff-invite testing from releasing the imported member base.

The worker claims with a ten-minute lease using `FOR UPDATE SKIP LOCKED`. Claim recovery requeues expired in-flight claims up to the existing attempt ceiling and records a safe diagnostic code. Live leases and sent rows are not reclaimed. SMTP acceptance followed by a lost local completion write can cause a later retry and duplicate mail: standard SMTP cannot atomically commit delivery and the database outbox.

## Supabase Auth review before launch

Supabase Auth remains responsible for account-confirmation and password-reset messages, separately from this transactional outbox.

App account sign-up sends `emailRedirectTo` to `/account?mode=signIn` (preserving a safe internal `next` destination); password reset returns to `/account/reset`. Confirm Supabase Auth Site URL and redirect allow-list include the production app origin and those paths. Inspect the hosted confirmation template and its sender separately: if email confirmations are enabled, a new account may receive both the R12 membership activation message and a Supabase confirmation message. Keep confirmation enabled unless the security owner explicitly approves a project-level policy change. Existing users sign in with their existing account; new users create a password and confirm if the project requires it, then continue to `/member-hub/link` to link the existing gym membership.

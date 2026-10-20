# Account deletion and Club induction deployment notes

## Club induction stages

`2026-10-20-account-deletion-requests.sql` adds the independent private account-deletion queue and operator audit workflow before the Club migrations. `2026-12-14-club-induction-stage-progress.sql` adds private stage-check rows for a member and published version, staff-only read/write RPCs, and guards on both existing final-completion RPCs. The Club migration must follow `2026-12-13-member-age-induction-access-eligibility.sql` because its final completion workflow uses that schema. Each required-section tick stores the member, version, venue, staff actor and timestamp and appends the normal Club audit event. The existing final completion RPC still creates the authoritative completion record; the existing access-safety evaluation continues to read that record and the configured grace/hold policy. Optional content sections are displayed but do not gate completion. Legacy booked inductions without a pinned published version remain incomplete and require staff review; the app does not silently repair or finalize them.

Before this migration is applied, the new interface intentionally fails closed: stage loading/saving fails and the final button remains disabled. Keep the former production UI/build until the migration is approved and applied to the intended environment. No migration was run in this work.

## Account deletion initiation

The account page now asks the signed-in user to re-enter the password and type `DELETE`. A same-origin server route verifies that password with a non-persistent Supabase Auth client, verifies the returned Auth user ID matches the session, and uses the server-only service-role client to create an idempotent pending request. Passwords and email addresses are not written to the request table or returned. RLS is enabled and direct browser table access is revoked. Users can read only their own request state.

The flow does **not** delete the Auth user, membership, subscriptions, payment evidence, safety records, audit records or other business data. A request enters a restricted operator queue. Operators are authorised only when their signed-in user ID is explicitly configured in `R12_PRIVACY_OPERATOR_USER_IDS` (comma-separated UUIDs); every update requires password reauthentication and typed confirmation and is recorded with an immutable actor-attributed event. Completion additionally requires operator attestations that retention was reviewed and eligible data was processed through approved systems. The system does not itself delete accounts or records. Configure the accountable privacy operator and verify their authority before enabling this route. App Review should wait until the owner names that operator/process and gives users an accurate processing-time and completion-confirmation commitment.

The migration requires the existing Club induction/access migrations through `2026-12-13-member-age-induction-access-eligibility.sql`, standard Supabase Auth roles, and the server-side `SUPABASE_SERVICE_ROLE_KEY` already used by `adminSupabase()`. The new route requires those app environment variables, but no credentials were added or read. Verify the functions and migration in a non-production environment before any deployment.

## Support contact

Repository records contain no verified public privacy/support address or dedicated support URL. `lib/legal.ts` still labels `pjgray1688@gmail.com` as a development placeholder; it was deliberately not promoted or replaced. The existing `members@r12.live`, `staff@r12.live` and `madhouse.accounts@r12.live` values are mail sender identities, not evidence of an approved, monitored privacy contact.

## Launch ordering

The deletion queue migration is independent and is ordered in the launch manifest for 20 October 2026. The staged Club induction migration follows the 13 December access-eligibility schema that it extends. Therefore the stage-saving UI cannot be enabled by a 1 November database release unless the underlying access-eligibility dependency is separately brought forward and validated; do not run the stage UI against a schema without its RPCs.

## Deletion request operations

Set `R12_PRIVACY_OPERATOR_USER_IDS` only to the Auth UUIDs of the named privacy operators approved by the owner. Blank disables the queue. `/account/privacy-requests` is hidden behind that allowlist; its API repeats the allowlist check and requires password reauthentication plus the typed word `PROCESS` for each update. The database records request submission and every operator status change in an RLS-protected, append-only audit table. Marking a request complete additionally requires both retention review and eligible-data processing attestations. Staff use existing approved deletion/anonymisation processes; this queue does not delete records, subscriptions or Auth identities itself.

The user-facing response deadline is one calendar month from receipt, recorded on the request. The privacy operator should respond without undue delay; where a lawful extension applies, inform the user within the first month and explain the reason. This timing follows the [ICO right to erasure guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/). The user can read the request status and response in the authenticated account page. If the approved process removes the login, the operator must provide the final confirmation through an independently verified user contact before removing access; repository source contains no verified privacy contact for that route.

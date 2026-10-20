# Account deletion and Club induction deployment notes

## Club induction stages

`2027-01-05-account-deletion-and-induction-stage-progress.sql` is a forward-only, additive migration. It adds private stage-check rows for a member and published version, staff-only read/write RPCs, and guards on both existing final-completion RPCs. Each required-section tick stores the member, version, venue, staff actor and timestamp and appends the normal Club audit event. The existing final completion RPC still creates the authoritative completion record; the existing access-safety evaluation continues to read that record and the configured grace/hold policy. Optional content sections are displayed but do not gate completion. Legacy booked inductions without a pinned published version remain incomplete and require staff review; the app does not silently repair or finalize them.

Before this migration is applied, the new interface intentionally fails closed: stage loading/saving fails and the final button remains disabled. Keep the former production UI/build until the migration is approved and applied to the intended environment. No migration was run in this work.

## Account deletion initiation

The account page now asks the signed-in user to re-enter the password and type `DELETE`. A same-origin server route verifies that password with a non-persistent Supabase Auth client, verifies the returned Auth user ID matches the session, and uses the server-only service-role client to create an idempotent pending request. Passwords and email addresses are not written to the request table or returned. RLS is enabled and direct browser table access is revoked. Users can read only their own request state.

The flow does **not** delete the Auth user, membership, subscriptions, payment evidence, safety records, audit records or other business data. A request remains pending/in review until an authorised privacy/account-lifecycle operator applies the documented retention and deletion process. No such operator UI or automated fulfilment service exists in this repository. This is a genuine App Store submission blocker until an operator/process is provided and tested. App Review should wait until the owner names that operator/process and gives users an accurate processing-time and completion-confirmation commitment.

The migration requires the existing Club induction/access migrations through `2026-12-13-member-age-induction-access-eligibility.sql`, standard Supabase Auth roles, and the server-side `SUPABASE_SERVICE_ROLE_KEY` already used by `adminSupabase()`. The new route requires those app environment variables, but no credentials were added or read. Verify the functions and migration in a non-production environment before any deployment.

## Support contact

No verified public privacy/support address or support URL was found in repository source. `lib/legal.ts` still labels `pjgray1688@gmail.com` as a development placeholder; it was deliberately not promoted or replaced. The existing `members@r12.live`, `staff@r12.live` and `madhouse.accounts@r12.live` values are mail sender identities, not evidence of an approved, monitored privacy contact.

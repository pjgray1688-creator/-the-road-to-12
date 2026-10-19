# Madhouse member account and shared-membership readiness

This is an operational preparation workflow; it does not import members, activate access, or initiate billing.

## Individual R12 accounts

- Every person remains a separate `club_customers` identity. Source email is not an identity key: duplicate email imports are flagged as ambiguous, and a self-claim is refused when more than one customer matches.
- A member may self-claim when Supabase has confirmed control of their R12 email and that email resolves to exactly one unlinked customer. The imported address alone is not proof: activation links are sent only to a unique address (or one explicitly verified by staff), and the claim RPC rechecks verified Auth email, exact unique match, and that the R12 account is not linked to another profile. Shared/ambiguous addresses are refused.
- For an email-less member, staff can help them create their own R12 account with an email they control, then use the customer profile’s staff-link flow. That flow requires a confirmed Auth account and an identity verification method/reason; it refuses linking one R12 user to a second member profile. Staff must not create or handle the member’s password.
- For a unique address, a member can receive the activation link and prove inbox control through the normal R12 account verification flow; staff need not attest each unique email. Shared/parent/partner addresses, missing addresses, and identity conflicts require staff assistance and a separate personal email or verified staff link. Staff verification is scoped to the exact current email; changing the profile email invalidates the match. The activation email only links the existing Club membership; it does not create payment authority or change access.
- The import readiness panel at `Club → Members → Import` summarizes login readiness and shared-household review. Its CSV omits email addresses. It does not infer identity, payer authority, paid status, or payment failure.

## Shared memberships and access

The existing model holds one membership, one billing arrangement, and one set of billing obligations for multiple authorised holders. Holder profiles and logins remain separate. The billing arrangement records payer identity separately from holders; a payer outside the household must have their own linked R12 customer account before R12 recurring billing can be represented. The payer may be reused across multiple memberships. Legacy household arrangements without that verified payer identity remain a review item and must stay with Club Manager until cutover approval. Billing state and payment-access suspension are keyed to the shared membership/obligation, so the same grace/suspension/recovery policy projects to all holders. A member’s home gym is preference data, not the authority for access; actual membership entitlement/location scope remains authoritative. An independent valid entitlement is not deleted by household changes or billing recovery.

The current schema records household holder changes and free-text reasons, but has no structured relationship proof. Therefore every multi-holder membership remains flagged for payer/relationship review in the readiness report. An arrangement’s recorded billing contact is not, by itself, confirmation that all holders’ relationship and payment responsibility were checked. Do not use an owner-supplied note (including the Scott Brown / Vicky Brookes note) as identity or payer proof.

## Cash membership payments

Member cash declarations remain declarations only. A member cannot settle an obligation by declaring cash. An authorised staff member must record the exact cash obligation amount, physical location, actual receipt date, scheduled billing-period start/end, paid-through date, and a verification note using the staff-confirmed settlement action. These are separately stored fields; the billing period is validated against that obligation's contractual due schedule, not the cash receipt date. The payment row records the verifier and an audit event captures the same evidence. Monthly renewal uses the stored anniversary day (including month-end/February clamping), so early or late settlement never moves it. Each settlement resolves one scheduled period; missed periods are not inferred or silently waived. Settlement/recovery clears only the matching payment-based suspension; the shared membership projection then refreshes for its holders. The paid-through date is evidence only: it does not extend/revive an expired membership or override cancellation. A payment recovery cannot by itself grant access to a cancelled, expired, or otherwise invalid membership; use the separate authorised membership renewal/reactivation workflow after review. Day/week passes are fixed duration and the database refuses a monthly billing arrangement for those one-off products.

## Before enabling in production

1. Review and apply the additive migration through the approved Supabase migration process; do not infer application from repository state.
2. Test self-claim with confirmed unique email, ambiguous/shared email refusal, staff link to a separately verified personal account, missing-email staff assistance, and cross-organisation denial in a disposable Supabase/PostgreSQL environment.
3. Test outbox gating: activation for a unique email may be queued but cannot be claimed into an R12 identity until the recipient verifies through Auth; shared/unverified personal addresses remain unavailable until staff resolves them. Never bulk-release activation mail until the sample and contact-data policy are reviewed.
4. Test multi-holder grace, payment suspension after policy threshold, successful provider/cash recovery, independent entitlements, and both Rotherham/Carlton access in an isolated tenant fixture.
5. Confirm shared payer responsibility and relationship evidence with the member and authorised payer. Do not make a billing change from the readiness report.
6. Test cash receipt date, exact scheduled period, paid-through date, amount, anniversary continuity, audit actor, idempotent replay, inactive-membership handling, and group access restoration before any live counter use.

Club Manager remains responsible for current legacy collections until a separately approved billing cutover. No current legacy Stripe merchant-account provenance or references are modified by this workflow.

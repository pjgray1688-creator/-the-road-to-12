# Madhouse existing-member R12 activation

This process links an already-existing, currently Active Madhouse gym customer and their exact membership to one verified R12 Auth identity. It does not create a customer, membership, payment, mandate, subscription or door entitlement. Glow Zone identity and age checks remain separate.

## Controlled rollout

1. Review and apply `supabase/migrations/2027-02-12-madhouse-member-self-service-activation-invitations.sql` after the existing migrations through `2027-02-11-club-membership-management-detail-ledger-compat.sql`. Do not apply it through the application or migration runner until reviewed.
2. Deploy the application code. Keep `R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED=false` while validating the preview.
3. Configure the existing transactional SMTP sender and authenticated notification worker as documented in `notification-delivery.md`. Set a unique server-only `R12_MADHOUSE_MEMBER_INVITATION_TOKEN_SECRET` to at least 32 random bytes (for example, generate 32 random bytes with the organisation's approved secret manager). Keep it out of browser variables and logs. Do not rotate it while invitations are pending or sent; the worker needs it to re-derive the email token.
4. An owner or gym admin with `members.link_account` opens Club → Members → **Invite existing members to R12**. The preview is read-only and shows current eligible counts, linked members, masked email state, invitation status and identity exceptions. No email is sent by preview.
5. Confirm the exact eligible count and review every exception. Shared addresses, duplicate profiles, placeholder addresses and account conflicts require staff identity review; do not use email alone to merge or reassign anyone.
6. When management is ready, set `R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED=true` and redeploy the server configuration. This enables delivery only; it does not queue a campaign. An authorised manager must return to the preview and explicitly confirm **Send invitations**. Queueing is limited to 250 per rolling 24 hours; the worker delivers bounded batches of at most 25 with the existing retry/idempotency controls.
7. Monitor the page for queued, sent, completed, expired and failed statuses. The worker and database retain delivery/audit state; they do not report opens or clicks. A link is valid for seven days and single-use.

## Member steps

- The invited member follows the email link and creates an R12 account or signs into an existing account.
- The invited address must be verified by Supabase Auth and exactly match the Club record. Merely entering an address is not verification.
- The verified claim RPC locks the invitation and customer, then calls the existing `club_claim_existing_member` RPC. That transfers the existing holder link and entitlement grants without altering the membership, dates, payer arrangement or history. Existing holder/access triggers perform the normal credential projection; the six-digit PIN/QR rules remain authoritative. Physical door access stays subject to the separate venue rollout.
- If email confirmation opens on a different device/browser, reopen the original Madhouse invitation link in the R12 browser after verifying the account. A different verified email, expired/replayed token, changed identity, shared email or account conflict fails closed and routes the person to staff verification.

## Pause and recovery

- To stop new invitation delivery, set `R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED=false`. Queued rows remain durable but are not claimed by the notification worker; already sent invitations remain valid until expiry unless separately revoked through a reviewed operational process.
- Do not delete invitation, outbox, customer or membership records to stop mail. The invitation table is inaccessible to browser table access; the management page uses capability-checked RPCs.
- Delivery failure is retryable through the existing outbox worker up to its configured attempt ceiling. A failed invitation may be re-issued from the refreshed preview after eligibility is rechecked. The per-customer active-invitation constraint prevents duplicate pending/sent links.
- A successful link is not an activation of physical door control. Do not change venue access mode as part of this process.

## Verification

Before enabling delivery, verify in a non-production environment: a unique verified email links only its invited customer; wrong verified email is rejected; shared email and an account already linked elsewhere remain unlinked; expiration and replay fail; current membership/product/dates and payer records are unchanged; only the existing claim RPC materialises grants; no email, token or membership detail appears in application logs. Never use a real member recipient for a test send.

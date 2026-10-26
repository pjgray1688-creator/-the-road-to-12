# Shared R12 account-deletion operations

This runbook covers the shared Supabase Auth identity used by Training, Club,
Coach and Glow Zone. It does not cancel gym memberships, coaching agreements,
subscriptions, Stripe or GoCardless agreements, or any other separately managed
service. Provider and service cancellation remains in its authorised workflow.

## Deployment prerequisites

1. Apply every ordered migration through `2027-01-21-glow-customer-self-registration.sql`, then review and apply `2027-01-22-account-deletion-executor.sql`. Check the production ledger and checksums first. Never edit the earlier request migration.
2. Configure `R12_PRIVACY_OPERATOR_ALLOWLIST` as a server-only JSON object mapping at least two existing Auth UUIDs to their real names. UUID-only or browser-supplied roles are rejected.
3. Configure a stable 32-byte base64 `R12_PRIVACY_NOTIFICATION_ENCRYPTION_KEY`. Store and rotate it as a production secret; an unplanned rotation makes pending addresses unreadable.
4. Configure authenticated TLS SMTP and the platform-neutral privacy sender. Verify delivery out of band without logging recipient addresses.
5. Keep service-role credentials server-only. The browser never receives deletion RPC grants, Storage credentials, or Auth Admin access.
6. Keep `R12_ACCOUNT_DELETION_EXECUTION_ENABLED=false` until the disposable-project test evidence is approved. Set it to `true` only in the separately authorised production release step.

## Operator procedure

1. The first allowlisted operator reauthenticates, inventories linked records, and records a `retain` or `hold` decision plus rationale for accounting, membership, transactions/refunds, safety, and audit evidence. A hold prevents execution.
2. A different named allowlisted operator reauthenticates and approves the unchanged plan hash.
3. The named second approver explicitly types `EXECUTE`. The database rejects any other operator and inventories exact-UUID references. Any unreviewed column, restrictive reference, coach-owned data concerning another person, or unresolved hold stops before mutation.
4. Eligible profile, training, workout, measurement, WHOOP, nutrition, and client coaching records are deleted by exact UUID policies. Club application access links are removed. `club_customers` is unlinked and de-identified while its business row remains. Nullable `ON DELETE SET NULL` Auth references are unlinked according to their existing schema contract.
5. Reviewed Storage objects owned by or metadata-tagged with the exact UUID are removed and absence is confirmed. A Storage failure stops before Auth deletion.
6. The server uses Supabase Auth Admin to hard-delete the identity and verifies it is absent. Database completion is still not recorded.
7. The server validates the prepared state, records immutable audit evidence, and claims a single notification attempt before sending a platform-neutral completion message to the encrypted previously verified address. Only confirmed delivery advances the request to `completed` and clears the ciphertext. A process interruption after the send begins remains `notification_sending` for manual provider reconciliation, preventing an automatic duplicate.

Failures remain `held`, `failed`, `notification_pending`, or `notification_sending`; they never appear
complete and are never silently retried. A retry is an explicit freshly
reauthenticated operator action. If ciphertext expires before delivery, stop and
use the approved privacy incident/recovery process rather than copying an address
from logs or inferring identity from email.

## Mandatory pre-production verification

Use a disposable Supabase project restored to the production migration ledger.
Test unlinked and linked Glow customers, an ordinary member, a staff identity
with retained audit references, an account with Storage objects, and two unrelated
control users. Confirm exact-UUID deletion, control-user digests/counts unchanged,
membership/payment records preserved, Auth sessions invalidated, failure recovery,
idempotent explicit retry, and receipt of the completion message. Record operator
names, plan hash, request/event IDs, timestamps, and the SMTP provider reference;
never record the recipient address or credentials.

The executor must remain disabled in production until the production dependency
inventory has been reviewed, all legitimate `hold` decisions have owners, two
operators and SMTP are configured, and this disposable-project exercise passes.

# Disposable shared-account deletion test

This procedure exercises one explicitly marked, pre-confirmed Supabase Auth
identity across Training, Club, Coach and Glow Zone. It does not cancel or alter
memberships, recurring payment agreements, Stripe, GoCardless, checkout,
inventory or another user's records.

## Controls and prerequisites

- Use two different real people already named by Auth UUID in the server-only
  `R12_PRIVACY_OPERATOR_ALLOWLIST`. Each operator signs in and reauthenticates
  with their own current password. Browser roles are ignored.
- Keep `R12_ACCOUNT_DELETION_EXECUTION_ENABLED=false`. The test override uses
  the exact disposable Auth UUID and run ID; both must match server-controlled
  Auth `app_metadata`, the confirmed email, the approved request target and the
  deterministic `example.test` address.
- Keep the existing 32-byte base64
  `R12_PRIVACY_NOTIFICATION_ENCRYPTION_KEY` stable for the whole request.
- Production must contain the ordered request and executor migrations. Confirm
  their ledger/checksums read-only before the test. Do not reapply them.
- The disposable test sink records an unmistakable `disposable-test:` delivery
  reference and sends no external mail. It is available only after the exact
  disposable-account checks pass. It tests state progression, not real SMTP;
  retain separate SMTP delivery evidence before enabling general execution.

## 1. Validate, then provision exactly one account

Load `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into the shell
from the approved secret manager; do not place values on the command line, in a
file in this repository, or in shell history. Choose a new run ID and a private
absolute credential path outside the repository:

```sh
umask 077
export R12_DELETION_TEST_RUN_ID=apple-glow-b5-20261027-01
export R12_DELETION_TEST_CREDENTIALS_FILE=/private/tmp/r12-deletion-apple-glow-b5-20261027-01.json
npm run account-deletion:test-user:check
export R12_DELETION_TEST_PROVISION_CONFIRM=CREATE_ONE_DISPOSABLE_ACCOUNT
npm run account-deletion:test-user:provision
```

The Admin `createUser` call sets `email_confirm: true`; it does not use invite,
signup, link-generation or mail APIs. The script derives a unique
`r12-deletion-<run-id>@example.test` address, refuses an existing address,
generates a strong password, verifies the confirmed identity and its
server-controlled marker, and writes the only credential copy with mode `0600`.
It never prints the email, password, service key or tokens.

For the Glow Zone login, copy fields directly to the local clipboard without
showing them in the terminal or recording them in test evidence:

```sh
jq -j .email "$R12_DELETION_TEST_CREDENTIALS_FILE" | pbcopy
jq -j .password "$R12_DELETION_TEST_CREDENTIALS_FILE" | pbcopy
```

Clear the clipboard after use. Keep the file only until sign-in and final
negative sign-in verification are complete, then remove it using the approved
secure local-file procedure.

## 2. Establish the exact disposable test scope

Read `userId` and `runId` from the private credential file. In a separately
authorised configuration change set these server-only values for the deployed
web revision containing this support:

```text
R12_ACCOUNT_DELETION_EXECUTION_ENABLED=false
R12_ACCOUNT_DELETION_TEST_USER_ID=<exact disposable userId>
R12_ACCOUNT_DELETION_TEST_RUN_ID=<exact runId>
```

Do not set the test UUID to an operator, member, staff user or existing customer.
Do not enable the global flag. A request for any other UUID, an unconfirmed
identity, non-`example.test` email, missing marker or mismatched run ID is denied
before data preparation.

## 3. Glow Zone and request checks

1. On a physical iPhone using the intended TestFlight build, sign in with the
   disposable credentials. Confirm it is not asked to verify its pre-confirmed
   email and remains in Glow Zone.
2. Open the Glow account/customer setup. Confirm a standalone `club_customers`
   record is created or linked for this exact UUID without a gym membership,
   entitlement, credit or payment agreement.
3. Open **Use Sunbed** before age/safety verification. Confirm the session is
   blocked and that no safety, payment or access check is bypassed.
4. From Account, submit deletion with current-password reauthentication and the
   exact `DELETE` confirmation. Record the request ID and disposable UUID in the
   restricted test evidence; do not record credentials or the email.
5. Confirm the request appears only to an authorised privacy operator and shows
   `awaiting_review`.

## 4. Two-person review and exact-UUID execution

1. Operator A signs in, freshly reauthenticates, and reviews the dependency
   inventory and the five retention categories. Use `hold` whenever a legitimate
   retention decision is unresolved. For this zero-commerce account, verify that
   accounting/transaction queries return no subject records; document that
   result rather than inventing a retention period. Record `retain` only for
   restricted audit/business evidence that has an established basis.
2. Operator B, a separately named allowlisted person, signs in, freshly
   reauthenticates, checks the unchanged plan hash, and types `APPROVE`.
3. Operator B types `EXECUTE`. Unknown UUID dependencies, coach/staff records,
   restrictive foreign keys, Storage residue or a retention hold must stop the
   request without deleting Auth. Do not bypass a hold; investigate and repeat
   review/approval only after a legitimate resolution.
4. For a clean disposable account, confirm exact-UUID eligible data is removed,
   its `club_customers.user_id` is cleared and direct personal fields are
   anonymised, and the business row/audit evidence is retained. Confirm no
   membership, billing, refund or provider rows changed. Compare pre/post counts
   or digests for at least two unrelated control users.
5. Confirm Storage inventory is empty, the Auth Admin hard delete succeeds, a
   subsequent Admin lookup returns not found, and the request reaches
   `completed` with an immutable `disposable-test:` delivery reference. This
   reference truthfully identifies the no-email test sink; it is not SMTP proof.

## 5. Negative and cleanup checks

1. Sign out/clear the app session, then confirm the deleted email/password can no
   longer sign in and no session refresh succeeds in any R12 app.
2. Confirm the anonymised customer cannot be resolved back to the deleted Auth
   UUID or email. Confirm the deletion request/event evidence remains restricted.
3. Confirm unrelated customer, member, staff, membership, payment, refund,
   inventory and provider records are unchanged.
4. Remove the two test-scope environment variables in a separately authorised
   configuration change and redeploy. Keep the global execution flag `false`.
5. Securely remove the local credential file and clear the clipboard. Retain only
   non-secret evidence: revision, operators, request/event IDs, plan hash,
   timestamps, dependency/storage results, control digests and test-sink receipt.

The executor is not approved for unrestricted accounts merely because this one
test passes. General enablement still requires reviewed retention policy,
production dependency evidence, live notification delivery evidence, failure
recovery testing and explicit release authorisation.

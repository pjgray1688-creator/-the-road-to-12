# Madhouse monthly billing-anchor preflight and resolution

## Purpose and safety

Run [`madhouse-monthly-billing-anchor-preflight.sql`](../supabase/deployment/madhouse-monthly-billing-anchor-preflight.sql)
against the reviewed production database before applying
`2026-12-31-cash-membership-period-and-anniversary-safety.sql`. The report is
read-only, emits identifiers and schedule/payment-period evidence only (no
names, email addresses, bank details, or provider payment references), and does
not certify an anniversary from a due date. Run it with an authorised
read-only/reporting connection and retain the output securely.

The migration deliberately stops if any monthly arrangement has a null
`billing_anchor_day`. It does not backfill from `next_due_at`. This is a
deployment stop condition, not a value for staff to work around.

Example invocation (do not put credentials on the command line or in shell
history; use the approved local secret mechanism):

```sh
psql "$R12_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/deployment/madhouse-monthly-billing-anchor-preflight.sql
```

The script opens a read-only transaction and rolls it back at the end. The
read-only result includes detail rows and totals by organisation/risk category.
Risk labels are review queues, not proof:

- `MISSING_ANCHOR_POSSIBLE_MONTH_END_CLAMP`: no anchor is stored and the current
  or recorded period begins at a shorter month end. A historical 29th/30th/28th
  may be a genuine contract date or a clamped 30th/31st.
- `MISSING_ANCHOR_REQUIRES_SOURCE_REVIEW`: no anchor is stored, but the
  available schedule evidence does not identify the original anniversary.
- `ANCHOR_CONFLICT`: a stored anchor disagrees with the current due date or
  historical period-start evidence. Verify whether a valid schedule change was
  made; do not overwrite it automatically.
- `ANCHOR_PRESENT_REVIEW_HISTORY`: an anchor exists and no contradiction was
  found in the available evidence. This is not independent proof that the
  stored value matches the contract.

## Manual source matching and resolution

For every missing or conflicting row:

1. Match the arrangement to the canonical member/membership using the
   organisation, Club Manager `MemberId`, `BranchId`, and membership/product
   source references. Keep `BranchId` separate from the member reference and
   physical/home location. Use the existing reconciliation preview to compare
   source exports; email overlap is not identity evidence and must not merge
   people.
2. Confirm the payer separately from covered holders. Verify the arrangement
   against the Club Manager billing schedule/contract and source payment-period
   history. A provider customer, mandate, historic charge, receipt date,
   `next_due_at`, or paid-through date alone does not prove the contractual
   anniversary.
3. Record the source artifact, source row/reference, reviewer, verified anchor
   day (1–31), and reason in the approved change/audit record. For a due date
   on the 28th/29th/30th at month end, resolve whether it is the true anchor or
   an earlier clamp using the source schedule, such as a preceding 31st and
   subsequent monthly cycle. If the source cannot settle that, leave it
   unresolved.
4. Have a second authorised reviewer check every proposed value and the
   resulting organisation-level totals. Apply only explicit reviewed anchor
   values through a separately reviewed, organisation- and arrangement-scoped
   SQL operation; never use a blanket `extract(day from next_due_at)` update.
5. Re-run the read-only preflight. **Stop** if any `MISSING_ANCHOR_*` or
   `ANCHOR_CONFLICT` rows remain. Do not run the 12-31 migration, deploy the
   dependent application, or enable any R12 collection worker while the review
   is unresolved. Preserve Club Manager as the live billing authority.

Do not use this report to change membership status, access, payer, provider
authority, amount, or collection schedule. Those require separate approval.

## Migration runner retry behavior

The explicit runner applies the 12-31 migration in one PostgreSQL transaction.
If any statement—including the unresolved-anchor stop—fails, PostgreSQL rolls
back the whole migration file and the runner does not write its checksum. The
constraint replacement first drops its exact final constraint name, so replay
is also safe if the SQL committed but the separate checksum-ledger insert did
not. A recorded checksum mismatch remains a hard stop and must not be bypassed.

## Migration-first deployment sequence

1. Confirm an encrypted, restorable production backup and record its restore
   verification. Do not proceed on backup creation alone.
2. Confirm the production activation-email gate is explicitly
   `R12_MEMBER_ACTIVATION_EMAILS_ENABLED=false`; do not enable it during import
   or anchor review. Confirm Club Manager remains the billing authority.
3. Run and review the read-only anchor preflight and complete the source-backed
   resolution above. Preserve the result and two-person approval.
4. Reconfirm the migration manifest and ledger/checksums, then apply the
   reviewed migration set using `scripts/apply-madhouse-schema.sh` in an
   approved maintenance window. Stop on any error or checksum mismatch. Keep
   R12 billing/notification workers from acting on unreviewed data during the
   window; do not disable or change Club Manager collection authority.
5. Run the documented post-migration schema/permission checks and re-run the
   anchor preflight. Confirm zero unresolved/conflicting rows, unchanged
   existing due dates, expected payment-method constraints, and no unintended
   activation-intent state changes. Verify migration ledger checksums.
6. Only after the database and anchor review are signed off, approve the
   `main` merge/production application deployment. Production deployment is
   automatically associated with `main` in the currently reported Vercel
   configuration; reconfirm that setting before the change. No merge or deploy
   is performed by this document or SQL report.
7. Then run member-import dry run, review identity/household/payer/location
   discrepancies, and separately approve the real import. Import does not
   create Auth identities or initiate payments, but activation notifications
   remain gated off.
8. Reconcile existing Stripe and GoCardless records read-only, preserving
   original merchant/creditor provenance. Do not migrate authorities or
   initiate charges. Any billing cutover requires a separate approval and
   duplicate-collection control plan.
9. Enable activation mail only after a reviewed eligible cohort and explicit
   approval. The gate is global, so unresolved or unverified recipient rows
   must not remain eligible when it is enabled.

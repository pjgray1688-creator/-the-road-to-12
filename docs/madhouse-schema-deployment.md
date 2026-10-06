# Madhouse schema deployment

This is the reviewed path from the known partially-applied Supabase state to the current R12 launch schema. It is repository-only until a trusted operator deliberately supplies a database connection string. It does not create Auth users, staff, members, memberships, supplier data, payments, or stock.

## What was reconciled

The repository contains 106 migration files. The launch manifest contains 98 ordered schema and RPC contract files, including the later corrective replacements. The runner records successful files in `public.r12_schema_migrations` and verifies the file checksum on every later run.

The known manual baseline is recorded, not replayed:

- Club foundation, branding, entitlement, transactional RPC, authenticated privileges, staff grants, classes/services, finance, member hub, commerce/inventory, shifts, cash/promotions, and staff capability audit.
- Coach safe workflow, organisation boundary, and staff access management.

The manifest deliberately excludes the go-live reset, physical stocktakes, reviewed image/data backfills, and the Active Sports generated-price backfill. Those are separate reviewed operational actions and must not be part of schema deployment.

It is intentionally not pure filename order. Supplier-commerce tables are created before the later parent/variant tables, and those tables are created before the older September supplier RPCs that reference them. The Glow Zone transaction tables likewise precede its September read RPC. This resolves the historical filename/dependency mismatch.

## Peter's primary workflow: one SQL Editor paste/run

Peter should use the raw SQL bundle, not local tooling:

1. Open [`2026-11-22-madhouse-manual-reconciliation.sql`](../supabase/deployment/2026-11-22-madhouse-manual-reconciliation.sql) as a raw text file.
2. Copy the entire file into the Supabase SQL Editor.
3. Run it once.
4. Review the final read-only result sets and the `SCHEMA READY — RUN MADHOUSE BOOTSTRAP NEXT` marker.

The bundle assumes the known manual baseline below. It contains the remaining schema/RPC contract in dependency order, the final additive profiles shape, an explicit WHOOP foundation required by the historical WHOOP patch, a reconciliation marker, and read-only readiness diagnostics. It does not create organisations, members, memberships, payments, Auth users, or Coach grants.

The SQL bundle is the established deployment workflow and requires no `psql`, Homebrew, Supabase CLI, local PostgreSQL, Docker, or local database connection.

The bundle is safe to start again after the earlier WHOOP failure: the only sections before that failure were the additive profile reconciliation and deployment-ledger creation. Both are guarded and contain no operational Club/member/payment mutations. The corrected bundle also guards the WHOOP tables and proceeds from the top.

## Optional advanced route

The shell runner remains available for an operator who deliberately has `psql` and a trusted database connection string:

```bash
R12_DATABASE_URL='[reviewed connection string]' ./scripts/apply-madhouse-schema.sh
```

It runs the same additive profile foundation and manifest in order with `ON_ERROR_STOP=1`. It is not required for Peter's normal workflow.

Do not run the old migration files manually after this process has started. If the database differs from the stated baseline, stop and review the diagnostic output before adding a deliberate baseline entry.

## Read-only readiness checks

Run these after the script and before bootstrap:

```sql
select count(*) as applied_migrations from public.r12_schema_migrations;
select migration_name, applied_at from public.r12_schema_migrations order by applied_at, migration_name;

select to_regclass('public.profiles'), to_regclass('public.club_organisations'),
  to_regclass('public.club_members'), to_regclass('public.club_customers'),
  to_regclass('public.club_memberships'), to_regclass('public.club_orders'),
  to_regclass('public.coach_permissions'), to_regclass('public.club_checklist_cycles'),
  to_regclass('public.club_member_notification_intents');

select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in (
  'club_list_staff_accounts','club_create_staff_access_grant',
  'club_claim_staff_access_grant','club_start_membership_joining',
  'club_claim_existing_member','club_submit_daily_check',
  'coach_has_access','club_claim_notification_intents'
) order by proname;

select count(*) as organisations from public.club_organisations;
select count(*) as club_members from public.club_members;
select count(*) as profiles from public.profiles;
select count(*) as coach_permissions from public.coach_permissions;
```

Before bootstrap, the last four counts should still be zero in the stated environment.

## Bootstrap Peter and Madhouse

1. Confirm Peter already has a verified Supabase Auth account. Do not create one in SQL.
2. Copy the exact Auth UUID and verified email.
3. Review and replace all `REPLACE_WITH_...` values in [`madhouse-first-organisation-bootstrap.sql`](manual-sql/madhouse-first-organisation-bootstrap.sql).
4. Leave `v_grant_coach := false` unless explicit Coach access is intended. This is an independent permission choice.
5. Run that script once in the Supabase SQL editor as a trusted administrator.
6. Re-run the read-only checks. There should be one Madhouse organisation, one Rotherham venue, one Peter `gym_admin` membership, one profile, and no gym membership unless created separately.
7. Peter signs in through `/account`, opens Club, and then uses Staff to invite the remaining people. Do not seed the other five staff in SQL.

Keenan's eventual protected owner designation remains a separate reviewed action.

## Future workflow

Every new migration must be added to the manifest in dependency order and tested. Apply it only through the runner; the ledger and checksum make drift visible. Keep data imports, stocktakes, payment/provider events, resets, and tenant bootstrap outside the schema manifest. Never mark a migration applied unless its SQL completed successfully on the target database.

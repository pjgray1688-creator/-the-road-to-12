#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

base_db="${PGDATABASE:-r12_ci}"
suffix="${GITHUB_RUN_ID:-ci}_${GITHUB_RUN_ATTEMPT:-1}_$$"
state_a="r12_nutrition_${suffix}_a"
state_b="r12_nutrition_${suffix}_b"
state_c="r12_nutrition_${suffix}_c"
state_anchor="r12_nutrition_${suffix}_anchor"
databases=("$state_a" "$state_b" "$state_c" "$state_anchor")
tmp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
tmp_dir="$(mktemp -d "${tmp_root%/}/r12-nutrition-ci.XXXXXX")"

psql_db() {
  local database="$1"
  shift
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" "$@"
}

anchor_migration_snapshot() {
  local database="$1"
  psql_db "$database" --tuples-only --no-align --command="
    select md5(concat_ws(E'\\n',
      (select string_agg(attrelid::regclass::text || '.' || attname || ':' || format_type(atttypid, atttypmod), E'\\n' order by attrelid::regclass::text, attnum)
       from pg_attribute where attrelid in ('public.club_membership_billing_arrangements'::regclass, 'public.club_membership_billing_payments'::regclass) and attnum > 0 and not attisdropped),
      (select string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), E'\\n' order by conrelid::regclass::text, conname)
       from pg_constraint where conrelid in ('public.club_membership_billing_arrangements'::regclass, 'public.club_membership_billing_payments'::regclass)),
      (select string_agg(tgrelid::regclass::text || '.' || tgname || ':' || pg_get_triggerdef(oid), E'\\n' order by tgrelid::regclass::text, tgname)
       from pg_trigger where not tgisinternal and tgrelid in ('public.club_membership_billing_arrangements'::regclass, 'public.club_membership_billing_obligations'::regclass)),
      (select string_agg(p.oid::regprocedure::text || ':' || pg_get_functiondef(p.oid) || ':acl=' || coalesce(p.proacl::text, 'NULL'), E'\\n' order by p.oid::regprocedure::text)
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in (
         'club_guard_recurring_membership_arrangement',
         'club_record_membership_cash_payment',
         'club_list_customer_billing')),
      (select string_agg(c.oid::regclass::text || ':acl=' || coalesce(c.relacl::text, 'NULL'), E'\\n' order by c.oid::regclass::text)
       from pg_class c where c.oid in ('public.club_membership_billing_arrangements'::regclass, 'public.club_membership_billing_obligations'::regclass, 'public.club_membership_billing_payments'::regclass)),
      (select string_agg(concat_ws(':', id, organisation_id, membership_id, coalesce(billing_anchor_day::text, 'NULL'), next_due_at::text), E'\\n' order by id)
       from public.club_membership_billing_arrangements),
      (select string_agg(concat_ws(':', id, organisation_id, arrangement_id, membership_id, next_due_at::text,
         coalesce(coverage_start_at::text, 'NULL'), coalesce(coverage_end_at::text, 'NULL'), period_key, state), E'\\n' order by id)
       from public.club_membership_billing_obligations)
    ));"
}

expect_anchor_migration_rejection() {
  local label="$1"
  local database="$2"
  local expected_detail="$3"
  local before after log_file status
  log_file="$tmp_dir/anchor-${label}.log"
  before="$(anchor_migration_snapshot "$database")"
  if psql_db "$database" --set=VERBOSITY=verbose --single-transaction --file=supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql >"$log_file" 2>&1; then
    cat "$log_file"
    echo "Expected the 12-31 migration to reject ${label} anchor evidence" >&2
    exit 1
  else
    status=$?
  fi
  if ! grep -Eq '(^|[[:space:]])55000([[:space:]:]|$)' "$log_file"; then
    cat "$log_file"
    echo "Expected SQLSTATE 55000 for ${label}; psql exited ${status}" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_detail" "$log_file"; then
    cat "$log_file"
    echo "Migration rejected ${label} for an unexpected reason; expected diagnostic: ${expected_detail}" >&2
    exit 1
  fi
  after="$(anchor_migration_snapshot "$database")"
  if [[ -z "$before" || "$before" != "$after" ]]; then
    echo "12-31 rejection for ${label} left partial schema, constraint, trigger, function or synthetic-row changes (before=${before:-empty}, after=${after:-empty})" >&2
    exit 1
  fi
  psql_db "$database" <<'SQL'
do $rollback_guard$ begin
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_billing_payments' and column_name in ('billing_period_start','billing_period_end')) then
      raise exception 'Rejected migration partially added billing-period columns';
    end if;
    if exists (select 1 from pg_constraint where conrelid='public.club_membership_billing_payments'::regclass and conname='club_membership_billing_payment_period_pair_check') then
      raise exception 'Rejected migration partially added the period-pair constraint';
    end if;
  end;
$rollback_guard$;
SQL
  echo "ANCHOR GUARD PASSED — ${label} rejected with SQLSTATE 55000 and full transaction rollback (${after})"
}

# Each SQL fixture is a separate transaction-scoped test unit. If one fails,
# psql closes its connection and PostgreSQL rolls that fixture's transaction
# back; independent fixtures can then still run against the unchanged disposable
# baseline. Migration/setup failures above remain fail-fast because later work
# depends on them.
fixture_failures=()
fixture_count=0
run_sql_fixture() {
  local label="$1"
  local fixture="$2"
  local log_file="$tmp_dir/fixture-${fixture_count}-$(basename "$fixture").log"
  local status=0
  fixture_count=$((fixture_count + 1))
  echo "FIXTURE — ${label} (${fixture})"
  if psql_db "$state_c" --file="$fixture" >"$log_file" 2>&1; then
    cat "$log_file"
    echo "FIXTURE PASSED — ${label}"
  else
    status=$?
    cat "$log_file"
    local sql_error
    sql_error="$(grep -E '^psql:.*:[0-9]+: (ERROR|FATAL|PANIC):' "$log_file" | head -n 1 || true)"
    if [[ -z "$sql_error" ]]; then sql_error="psql exited ${status}; see preceding fixture output"; fi
    fixture_failures+=("${label}: ${sql_error}")
    echo "FIXTURE FAILED — ${label} (exit ${status})" >&2
  fi
}

cleanup() {
  local status=$?
  for database in "${databases[@]}"; do
    dropdb --if-exists --maintenance-db=postgres "$database" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT

for command_name in psql createdb dropdb python3; do
  command -v "$command_name" >/dev/null || { echo "Required PostgreSQL CI tool missing: $command_name" >&2; exit 1; }
done

python3 - \
  "$repo_root/supabase/migrations/2026-11-27-coach-nutrition-accountability.sql" \
  "$tmp_dir/state-b-pre-error.sql" \
  "$tmp_dir/state-c-corrected-11-27.sql" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
prefix_path = Path(sys.argv[2])
corrected_path = Path(sys.argv[3])
anchor = "create or replace function public.nutrition_can_read_client(p_client_user_id uuid)"
if source.count(anchor) != 1:
    raise SystemExit("Expected exactly one nutrition_can_read_client boundary in committed 11-27 migration")
prefix, _, _ = source.partition(anchor)
if "revoke all on table public.nutrition_plans" not in prefix or "nutrition_coach_feedback" not in prefix:
    raise SystemExit("11-27 pre-error prefix did not include the complete preceding Nutrition table/security statements")
prefix_path.write_text(prefix)

broken = "where a.client_user_id=p_client_user_id and a.coach_user_id=auth.uid() and a.active;\n$$;"
fixed = "where a.client_user_id=p_client_user_id and a.coach_user_id=auth.uid() and a.active);\n$$;"
if source.count(broken) != 1:
    raise SystemExit("Expected exactly one known missing-parenthesis defect in committed 11-27 migration")
corrected_path.write_text(source.replace(broken, fixed, 1))
PY

for database in "$state_a" "$state_b" "$state_c"; do
  echo "Creating fresh disposable database ${database} from prerequisite baseline ${base_db}"
  createdb --maintenance-db=postgres --template="$base_db" "$database"
done

echo "STATE A — 11-27 never ran"
psql_db "$state_a" --file=supabase/migrations/2026-12-15-coach-nutrition-reconciliation.sql
psql_db "$state_a" --file=tests/sql/nutrition-reconciliation-catalog.sql
psql_db "$state_a" --file=tests/sql/nutrition-reconciliation-behavior.sql
echo "STATE A PASSED"

echo "STATE B — actual statements before the broken 11-27 function"
psql_db "$state_b" --file="$tmp_dir/state-b-pre-error.sql"
psql_db "$state_b" --file=supabase/migrations/2026-12-15-coach-nutrition-reconciliation.sql
psql_db "$state_b" --file=tests/sql/nutrition-reconciliation-catalog.sql
psql_db "$state_b" --file=tests/sql/nutrition-reconciliation-behavior.sql
echo "STATE B PASSED"

echo "STATE C — temporary corrected 11-27 followed by 12-15"
psql_db "$state_c" --file="$tmp_dir/state-c-corrected-11-27.sql"
psql_db "$state_c" --file=supabase/migrations/2026-12-15-coach-nutrition-reconciliation.sql
psql_db "$state_c" --file=tests/sql/nutrition-reconciliation-catalog.sql
psql_db "$state_c" --file=tests/sql/nutrition-reconciliation-behavior.sql

before="$(psql_db "$state_c" --tuples-only --no-align --file=tests/sql/nutrition-reconciliation-snapshot.sql | tail -n 1)"
echo "RERUN — applying 12-15 again with Nutrition records present (fingerprint ${before})"
psql_db "$state_c" --file=supabase/migrations/2026-12-15-coach-nutrition-reconciliation.sql
after="$(psql_db "$state_c" --tuples-only --no-align --file=tests/sql/nutrition-reconciliation-snapshot.sql | tail -n 1)"
if [[ -z "$before" || "$before" != "$after" ]]; then
  echo "12-15 rerun changed Nutrition data (before=${before:-empty}, after=${after:-empty})" >&2
  exit 1
fi
psql_db "$state_c" --file=tests/sql/nutrition-reconciliation-catalog.sql
echo "STATE C AND RERUN PASSED; all nine Nutrition-table fingerprints are unchanged"

echo "MEMBERSHIPS — apply paid-provider and recurring-coverage prerequisites"
psql_db "$state_c" --file=supabase/migrations/2026-12-01-paid-member-provider-checkout.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-02-gocardless-recurring-collections.sql
echo "CLUB ACCESS — apply real member import/access and PIN/QR prerequisites"
psql_db "$state_c" --file=supabase/migrations/2026-12-03-member-import-and-access.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql
echo "ACTIVE SPORTS — apply the existing POS product/inventory RPC migration required by the fixture"
psql_db "$state_c" --file=supabase/migrations/2026-12-07-club-pos-sellable-units-and-pt-packages.sql
echo "MEMBERSHIPS — apply access lifecycle and eligibility prerequisites for household coverage tests"
psql_db "$state_c" --file=supabase/migrations/2026-12-12-membership-access-lifecycle.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-13-member-age-induction-access-eligibility.sql
echo "ACTIVE SPORTS — apply forward importer fix and exercise the real import/link path"
psql_db "$state_c" --file=supabase/migrations/2026-12-16-active-sports-import-update-scope-fix.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-17-active-sports-link-manual-price-fix.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-18-active-sports-manual-price-propagation.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-19-supplier-authoritative-canonical-price-guard.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-20-active-sports-generated-price-propagation.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-21-active-sports-commerce-link-performance.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-22-member-import-home-location.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-23-club-attendance-station-leaderboard.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-24-staff-owner-transfer-and-member-activation-queue.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-25-notification-generator-null-safe-auth-lookup.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-26-notification-generator-record-alias-safety.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-27-staff-claim-context.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-28-club-shared-station-pin-auth.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-29-pgcrypto-schema-qualified-functions.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-30-club-station-password-reauth.sql
psql_db "$state_c" --file=supabase/migrations/2026-12-30-member-account-readiness-and-cash-evidence.sql

echo "ANNIVERSARY MIGRATION GUARD — clone the post-12-30 state for negative and corrected-anchor paths"
createdb --maintenance-db=postgres --template="$state_c" "$state_anchor"
psql_db "$state_anchor" --file=tests/sql/member-billing-anchor-migration-guard.sql
psql_db "$state_anchor" --command="update public.club_membership_billing_arrangements set billing_anchor_day=null where id='4a000000-0000-4000-8000-000000000001';"
expect_anchor_migration_rejection "missing-anchor" "$state_anchor" "1 monthly arrangements have missing anchors"

psql_db "$state_anchor" --command="update public.club_membership_billing_arrangements set billing_anchor_day=30 where id='4a000000-0000-4000-8000-000000000001'; update public.club_membership_billing_obligations set coverage_start_at='2024-03-31 10:00:00+00' where id='4a000000-0000-4000-8000-000000000002';"
expect_anchor_migration_rejection "conflicting-obligation-evidence" "$state_anchor" "1 have conflicting schedule evidence"

psql_db "$state_anchor" --command="update public.club_membership_billing_arrangements set billing_anchor_day=30 where id='4a000000-0000-4000-8000-000000000001'; update public.club_membership_billing_obligations set coverage_start_at='2024-03-30 10:00:00+00' where id='4a000000-0000-4000-8000-000000000002';"
psql_db "$state_anchor" --single-transaction --file=supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql
psql_db "$state_anchor" --file=tests/sql/member-billing-anchor-migration-guard-success.sql
echo "ANNIVERSARY MIGRATION GUARD PASSED — corrected synthetic anchor/evidence permits the migration"

psql_db "$state_c" --single-transaction --file=supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql
psql_db "$state_c" --file=supabase/migrations/2027-01-01-club-access-safety-empty-booking-fix.sql
psql_db "$state_c" --single-transaction --file=supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql
psql_db "$state_c" --single-transaction --file=supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql

# These fixtures have separate synthetic identities and each owns a BEGIN /
# ROLLBACK boundary. Continue across independent fixture files so one SQL
# failure cannot hide diagnostics from the rest of the disposable test suite.
run_sql_fixture "Household billing lifecycle" tests/sql/member-household-billing-lifecycle.sql
run_sql_fixture "Notification outbox permissions and retry" tests/sql/notification-outbox-launch.sql
run_sql_fixture "Notification generation" tests/sql/notification-generation-launch.sql
run_sql_fixture "Staff owner transfer" tests/sql/staff-owner-transfer.sql
run_sql_fixture "Club station PIN reauthentication" tests/sql/club-station-pin-reauth.sql
run_sql_fixture "Active Sports import RPC" tests/sql/active-sports-import-v2.sql

if ((${#fixture_failures[@]})); then
  echo "POSTGRES FIXTURE FAILURE SUMMARY (${#fixture_failures[@]} failed):" >&2
  for fixture_failure in "${fixture_failures[@]}"; do
    echo " - ${fixture_failure}" >&2
  done
  exit 1
fi
echo "ALL DISPOSABLE POSTGRES FIXTURES PASSED"

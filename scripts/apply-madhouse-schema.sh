#!/usr/bin/env bash
set -euo pipefail

# One deterministic, stop-on-error deployment path for the known partial Club
# state. It never creates Auth users or data-seeds staff/members.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database_url="${R12_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$database_url" ]]; then
  echo "Set R12_DATABASE_URL (or DATABASE_URL) to the reviewed Supabase database connection string." >&2
  exit 2
fi

psql_args=("$database_url" -v ON_ERROR_STOP=1)
manifest="$repo_root/supabase/deployment/2026-11-22-madhouse-launch-migrations.txt"
ledger_setup="$repo_root/supabase/deployment/2026-11-22-r12-deployment-ledger.sql"
profile_setup="$repo_root/supabase/deployment/2026-11-22-r12-profile-foundation.sql"

psql "${psql_args[@]}" -f "$profile_setup"
psql "${psql_args[@]}" -f "$ledger_setup"

record_baseline() {
  local migration="$1"
  local checksum
  checksum="$(shasum -a 256 "$repo_root/$migration" | awk '{print $1}')"
  psql "${psql_args[@]}" -v migration_name="$migration" -v migration_checksum="$checksum" -v migration_note="manually applied before R12 ledger" -c \
    "insert into public.r12_schema_migrations(migration_name,checksum,source,note) values (:'migration_name',:'migration_checksum','manual-baseline',:'migration_note') on conflict (migration_name) do nothing;"
}

# These are the exact SQL files reported as already applied manually. They are
# recorded, never replayed. The later files in the manifest still replace any
# earlier RPC definitions where the current application requires it.
while IFS= read -r migration; do
  [[ -z "$migration" ]] || record_baseline "$migration"
done <<'BASELINE'
supabase/migrations/2026-09-03-club-foundation.sql
supabase/migrations/2026-09-03-club-branding.sql
supabase/migrations/2026-09-04-club-product-entitlements.sql
supabase/migrations/2026-09-05-club-transactional-rpcs.sql
supabase/migrations/2026-09-06-club-authenticated-table-privileges.sql
supabase/migrations/2026-09-06-club-staff-access-grants.sql
supabase/migrations/2026-09-07-club-classes-bookings-services.sql
supabase/migrations/2026-09-07-club-finance-foundation.sql
supabase/migrations/2026-09-07-club-member-hub-boundary.sql
supabase/migrations/2026-09-08-club-commerce-payments-inventory.sql
supabase/migrations/2026-09-08-club-finance-shift-times.sql
supabase/migrations/2026-09-09-club-cash-credits-promotions.sql
supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql
supabase/migrations/2026-09-26-coach-safe-workflow.sql
supabase/migrations/2026-10-05-coach-organisation-boundary.sql
supabase/migrations/2026-10-05-coach-staff-access-management.sql
BASELINE

while IFS= read -r migration; do
  [[ -z "$migration" || "$migration" == \#* ]] && continue
  [[ -f "$repo_root/$migration" ]] || { echo "Manifest file is missing: $migration" >&2; exit 3; }
  checksum="$(shasum -a 256 "$repo_root/$migration" | awk '{print $1}')"
  recorded="$(psql "${psql_args[@]}" -At -v migration_name="$migration" -c "select checksum from public.r12_schema_migrations where migration_name=:'migration_name'")"
  if [[ -n "$recorded" ]]; then
    [[ "$recorded" == "$checksum" ]] || { echo "Checksum mismatch for recorded migration: $migration" >&2; exit 4; }
    echo "skip $migration"
    continue
  fi
  echo "apply $migration"
  if [[ "$migration" == "supabase/migrations/2026-10-20-account-deletion-requests.sql" || "$migration" == "supabase/migrations/2026-12-14-club-induction-stage-progress.sql" || "$migration" == "supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql" || "$migration" == "supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql" || "$migration" == "supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql" || "$migration" == "supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql" || "$migration" == "supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql" || "$migration" == "supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql" ]]; then
    # Keep this schema/data migration atomic. If any statement fails, PostgreSQL
    # rolls back the whole file and the checksum ledger remains untouched.
    psql "${psql_args[@]}" --single-transaction -f "$repo_root/$migration"
  else
    psql "${psql_args[@]}" -f "$repo_root/$migration"
  fi
  psql "${psql_args[@]}" -v migration_name="$migration" -v migration_checksum="$checksum" -c \
    "insert into public.r12_schema_migrations(migration_name,checksum,source) values (:'migration_name',:'migration_checksum','r12-runner');"
done < "$manifest"

echo "R12 schema deployment completed. Run the documented contract queries before the Madhouse bootstrap."

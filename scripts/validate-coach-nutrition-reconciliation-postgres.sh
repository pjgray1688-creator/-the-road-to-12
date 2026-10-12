#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

base_db="${PGDATABASE:-r12_ci}"
suffix="${GITHUB_RUN_ID:-ci}_${GITHUB_RUN_ATTEMPT:-1}_$$"
state_a="r12_nutrition_${suffix}_a"
state_b="r12_nutrition_${suffix}_b"
state_c="r12_nutrition_${suffix}_c"
databases=("$state_a" "$state_b" "$state_c")
tmp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
tmp_dir="$(mktemp -d "${tmp_root%/}/r12-nutrition-ci.XXXXXX")"

psql_db() {
  local database="$1"
  shift
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" "$@"
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

for database in "${databases[@]}"; do
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

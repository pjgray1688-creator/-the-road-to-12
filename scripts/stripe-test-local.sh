#!/usr/bin/env bash
set -euo pipefail

# Build a real, throwaway Supabase Auth/Postgres stack and run the reviewed R12
# schema chain locally. This script never links to or connects to a hosted
# Supabase project. The app is then served against the local stack only.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stack_root="${TMPDIR:-/tmp}"
stack_dir="$(mktemp -d "${stack_root%/}/r12-stripe-local.XXXXXX")"
project_id="r12-stripe-$(basename "$stack_dir" | tr '[:upper:].' '[:lower:]_')"

for command_name in supabase docker psql node npm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing local prerequisite: ${command_name}. Install/start local tooling; no hosted database fallback is used." >&2
    exit 2
  }
done

if [[ -z "${R12_STRIPE_TEST_ENV_FILE:-}" || ! -f "$R12_STRIPE_TEST_ENV_FILE" ]]; then
  echo "Set R12_STRIPE_TEST_ENV_FILE to a private shell file containing the Franchise test key, account ID, and Stripe CLI webhook secret." >&2
  exit 2
fi

# This file is explicitly supplied by the operator, never pulled from Vercel.
# It must contain only test-mode values and must not be committed.
set -a
# shellcheck source=/dev/null
source "$R12_STRIPE_TEST_ENV_FILE"
set +a

if [[ "${STRIPE_FRANCHISE_MODE:-}" != "test" \
  || "${STRIPE_FRANCHISE_SECRET_KEY:-}" != sk_test_* \
  || "${STRIPE_FRANCHISE_WEBHOOK_SECRET:-}" != whsec_* \
  || "${STRIPE_FRANCHISE_ACCOUNT_ID:-}" != acct_* ]]; then
  echo "The private test env file must define STRIPE_FRANCHISE_MODE=test and matching test key, account ID, and webhook signing secret." >&2
  exit 2
fi

# A read-only account lookup ensures the supplied test key belongs to the
# configured Franchise account before any app server is started. Values stay
# in environment memory and only the boolean result is printed.
STRIPE_FRANCHISE_SECRET_KEY="$STRIPE_FRANCHISE_SECRET_KEY" \
STRIPE_FRANCHISE_ACCOUNT_ID="$STRIPE_FRANCHISE_ACCOUNT_ID" node --input-type=module -e '
  const response = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${process.env.STRIPE_FRANCHISE_SECRET_KEY}` },
  });
  if (!response.ok) process.exit(2);
  const account = await response.json();
  if (account.id !== process.env.STRIPE_FRANCHISE_ACCOUNT_ID) process.exit(3);
' || {
  echo "Stripe test-key account verification failed; no Checkout request was made." >&2
  exit 3
}

echo "Creating a separate local Supabase project at ${stack_dir}"
mkdir -p "$stack_dir"
cd "$stack_dir"
supabase init --yes
sed -i.bak -E "s/^project_id = .*/project_id = \"${project_id}\"/" supabase/config.toml
rm -f supabase/config.toml.bak

# Keep this local project's Supabase migrations directory empty: the repository
# uses a reviewed deployment manifest and date-formatted filenames, not the
# CLI's default timestamp migration loader. We apply the same final-state
# baseline used by isolated PostgreSQL CI, then only the manifest tail.
supabase start >/dev/null

status_env="$(supabase status --output env)"
eval "$status_env"
if [[ "${DB_URL:-}" != postgresql://postgres:*@127.0.0.1:*/* \
  && "${DB_URL:-}" != postgresql://postgres:*@localhost:*/* ]]; then
  echo "Refusing database URL that is not the isolated local Supabase stack." >&2
  exit 4
fi
if [[ "${API_URL:-}" != http://127.0.0.1:* && "${API_URL:-}" != http://localhost:* ]]; then
  echo "Refusing Supabase API URL that is not loopback." >&2
  exit 4
fi

psql_run() {
  psql "$DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 "$@"
}
apply_migration() {
  local migration="$repo_root/$1"
  [[ -f "$migration" ]] || { echo "Required reviewed migration is missing: $1" >&2; exit 5; }
  echo "Applying local schema: $1"
  psql_run --file "$migration"
}

apply_migration supabase/deployment/2026-11-22-r12-profile-foundation.sql
for migration in \
  2026-09-03-club-foundation.sql \
  2026-09-03-club-branding.sql \
  2026-09-04-club-product-entitlements.sql \
  2026-09-05-club-transactional-rpcs.sql \
  2026-09-06-club-authenticated-table-privileges.sql \
  2026-09-07-club-classes-bookings-services.sql \
  2026-09-08-club-commerce-payments-inventory.sql \
  2026-09-09-club-cash-credits-promotions.sql \
  2026-09-10-club-membership-access.sql \
  2026-09-11-club-induction.sql \
  2026-09-12-club-membership-lifecycle.sql \
  2026-09-13-club-staff-capabilities-audit.sql \
  2026-09-06-club-staff-access-grants.sql \
  2026-09-18-club-delivery-pricing.sql \
  2026-09-19-club-member-account-identity.sql \
  2026-09-20-club-commerce-product-brand.sql \
  2026-09-22-club-supplier-commerce.sql \
  2026-09-23-club-supplier-capabilities.sql \
  2026-09-24-club-supplier-catalogue-operations.sql \
  2026-09-25-club-madhouse-balance.sql \
  2026-09-26-coach-safe-workflow.sql \
  2026-09-26-club-supplier-cycles.sql \
  2026-09-27-club-payment-attempts-split-tender.sql \
  2026-09-28-club-membership-billing-dunning.sql \
  2026-09-29-club-shelf-removals-discounts.sql \
  2026-09-30-club-member-import.sql \
  2026-10-01-club-promotions-engine.sql \
  2026-10-02-club-member-joining.sql \
  2026-10-04-club-stock-replenishment.sql \
  2026-10-05-club-membership-cash-settlement.sql; do
  apply_migration "supabase/migrations/$migration"
done
apply_migration supabase/deployment/2026-11-22-madhouse-final-state-reconciliation.sql

tail_started=false
while IFS= read -r migration; do
  [[ -z "$migration" || "$migration" == \#* ]] && continue
  if [[ "$migration" == "supabase/migrations/2026-11-23-coach-independent-client-relationships.sql" ]]; then
    tail_started=true
  fi
  if [[ "$tail_started" == true ]]; then apply_migration "$migration"; fi
done < "$repo_root/supabase/deployment/2026-11-22-madhouse-launch-migrations.txt"
[[ "$tail_started" == true ]] || { echo "Launch manifest does not contain the expected post-baseline marker." >&2; exit 5; }

if [[ ! -d "$repo_root/node_modules" ]]; then
  echo "Install the existing lockfile dependencies with npm ci, then rerun this script." >&2
  exit 6
fi

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:?Local Supabase anon key missing}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?Local Supabase service key missing}"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:3000"
export R12_APP_BASE_URL="http://127.0.0.1:3000"
export R12_CLUB_SCHEMA_ENABLED=true
export R12_CLUB_CATALOGUE_BOOTSTRAP_ENABLED=false
export R12_MEMBER_ACTIVATION_EMAILS_ENABLED=false
export R12_PAYPAL_PAY_IN_3_ENABLED=false
export STRIPE_FRANCHISE_MODE=test
# Prevent any credentials inherited from a developer's normal .env.local from
# activating other providers during this local membership-only session.
export STRIPE_PRODUCTS_SERVICES_SECRET_KEY=
export STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET=
export STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID=
export STRIPE_PRODUCTS_SERVICES_MODE=
export STRIPE_SECRET_KEY=
export STRIPE_WEBHOOK_SECRET=
export STRIPE_MEMBERSHIP_MODE=
export GOCARDLESS_ACCESS_TOKEN=
export GOCARDLESS_WEBHOOK_SECRET=
export PAYPAL_CLIENT_ID=
export PAYPAL_CLIENT_SECRET=
export R12_EMAIL_PROVIDER=mock

echo "Local Supabase/Auth schema is ready. The isolated project directory is ${stack_dir}."
echo "Create a local owner/test plan using the reviewed local bootstrap flow before joining."
echo "Stop (retain local data): supabase stop --workdir ${stack_dir}"
echo "Starting R12 against local Auth and database at ${API_URL}; Stripe mode is test."
cd "$repo_root"
exec npm run dev -- --hostname 127.0.0.1

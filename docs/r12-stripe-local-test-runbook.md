# Isolated R12 Stripe test-mode joining

This path uses a fresh local Supabase stack (real GoTrue Auth, `auth.users`, PostgREST, PostgreSQL and RLS), the local R12 app, and Stripe CLI's authenticated event relay. It does not require another Supabase project/subscription, link either hosted project, pull Vercel env, register a dashboard webhook, or use a Vercel Preview database. Stripe CLI relays signed test events to loopback and supplies a local-only `whsec_` value; do not use the Preview webhook secret here.

## One-time Mac prerequisites

Install and start Docker Desktop, then install the CLIs:

```sh
brew install --cask docker
open -a Docker
brew install supabase/tap/supabase stripe/stripe-cli libpq
export PATH="$(brew --prefix libpq)/bin:$PATH"
```

Wait for Docker Desktop to report ready. Authenticate Stripe CLI to the Madhouse Franchise Stripe account that owns the configured test key:

```sh
stripe login
```

The CLI login is only used to relay test events. No production Stripe endpoint is registered or changed.

## Start the authenticated local receiver

In Terminal 1, start the Franchise membership event relay:

```sh
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,charge.refunded,charge.updated,charge.dispute.created,charge.dispute.closed \
  --forward-to http://127.0.0.1:3000/api/webhooks/stripe
```

Stripe CLI prints a temporary signing secret for this listener. Put that value in a private, untracked shell file outside the repo along with the Franchise *test* secret and expected `acct_...` ID:

```sh
umask 077
mkdir -p "$HOME/.config/r12"
${EDITOR:-vi} "$HOME/.config/r12/stripe-franchise-test.env"
```

The file must define `STRIPE_FRANCHISE_SECRET_KEY=sk_test_...`, `STRIPE_FRANCHISE_ACCOUNT_ID=acct_...`, `STRIPE_FRANCHISE_WEBHOOK_SECRET=whsec_...` (from this `stripe listen` process), and `STRIPE_FRANCHISE_MODE=test`. Copy the test key/account ID securely from the already configured Vercel Preview settings and confirm the account belongs to Madhouse Franchise Limited (17383077); do not run `vercel env pull`. Do not paste values into chat, commit them, or use the Preview webhook secret. Keep Terminal 1 running.

## Build the isolated local schema and launch R12

In Terminal 2, from the integration branch checkout:

```sh
cd /path/to/the-road-to-12
export R12_STRIPE_TEST_ENV_FILE="$HOME/.config/r12/stripe-franchise-test.env"
bash scripts/stripe-test-local.sh
```

The helper creates a uniquely named Supabase project in the OS temporary directory, does not `supabase link`, confirms the database/API URLs are loopback, and verifies the test Stripe key's account with a read-only `/v1/account` request. It loads the same PostgreSQL final-state baseline used by isolated migration CI plus every migration after that baseline in the reviewed launch manifest. It uses local Supabase's real Auth schema rather than the CI-only `auth.users` shim. The local stack is retained after the app exits; stop it without deleting its data with `supabase stop --workdir <printed-temporary-project-directory>`.

Create a local owner account at `http://127.0.0.1:3000`, then use the reviewed [first-organisation bootstrap](manual-sql/madhouse-first-organisation-bootstrap.sql) only against the local Studio SQL editor. In that same local-only editor, set `member_joinable=true` for `slug='madhouse-gym'`; the reviewed first-organisation bootstrap intentionally leaves public joining disabled. Add Carlton in Club → Locations. As the local owner, create one monthly Madhouse plan and its joining fee through the normal Club UI. Do not copy production member/customer rows or use a production dump. Create a separate local test member account and start joining; choose either or neither home location. Both sites must be shown as included.

Use Stripe's test card `4242 4242 4242 4242` with any future expiry and CVC. Verify the hosted Checkout shows the joining fee plus first monthly amount due now and the recurring amount/interval. Leave Terminal 1 running until the signed webhook is accepted. Confirm access is absent before payment and after browser return alone; after signed Checkout/subscription events, confirm exactly one membership and organisation-wide `gym_access`. Evaluate Rotherham and Carlton independently and confirm existing age, induction, suspension, and safety restrictions still apply regardless of the optional home preference.

This helper only supports local test-mode Franchise membership. It does not set Products & Services credentials, PayPal, GoCardless, production values, or a live activation path. An actual test purchase is an operator action and should be explicitly scheduled; the helper itself never creates a Checkout Session or payment.

## Why not the existing SQL CI harness?

`.github/workflows/validate-migrations-postgres.yml` uses a disposable PostgreSQL service and creates a minimal `auth.users` table plus JWT helper functions. It is appropriate for SQL/RLS fixtures but does not run GoTrue, PostgREST, browser Auth sessions, or a reachable Stripe receiver. The local stack plus Stripe CLI is the smallest no-subscription setup that tests those real boundaries together.

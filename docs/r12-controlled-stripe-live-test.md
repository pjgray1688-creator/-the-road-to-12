# Controlled Stripe live routing test

The owner-only screen is `/club/launch-readiness/stripe/live-test` (production: `https://app.r12.live/club/launch-readiness/stripe/live-test`). It offers one £1.00 card-only Checkout for each configured merchant. The server fixes the amount, account route, metadata and payment mode. The screen creates no memberships, orders, classes, entitlements, subscriptions, notifications or fulfilment records. A redirect never means paid; only a correctly signed event on the matching merchant webhook can reconcile the result.

## Before enabling the screen

1. Confirm both ordinary flags remain `STRIPE_FRANCHISE_LIVE_ENABLED=false` and `STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED=false` in Vercel Production. Do not change them for this test.
2. In each Stripe Dashboard, the owner must independently confirm the displayed account ID, current business/account-holder details, and that the restricted key belongs to that account. Record an internal evidence reference. The current dashboard labels expected by the code are `Madhouse Gym Rotherham` for Franchise routing and `Madhouse Gym Carlton` for Products & Services routing. These are observed account labels, not proof that pending company-name transitions have completed.
3. Confirm `STRIPE_FRANCHISE_ACCOUNT_ID` and `STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID` are correct and distinct, the API keys are the correct live restricted keys, and the three webhook signing secrets are distinct and mapped in Stripe Dashboard to:
   - `/api/webhooks/stripe` using `STRIPE_FRANCHISE_WEBHOOK_SECRET`;
   - `/api/webhooks/stripe/products-services` using `STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET`;
   - `/api/webhooks/stripe/classes` using `STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET`.
   The first two endpoints must subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed`. The class endpoint is separately signed and ignores this controlled test marker; it must continue to receive its class events. Environment-variable presence alone does not prove the Dashboard mapping.
4. Ensure both restricted live keys have the narrow Checkout Sessions write permission needed by `POST /v1/checkout/sessions`. The screen does not probe this permission. One owner click performs the first real resource request and tests it. If Stripe returns a permission error, this merchant's one attempt is consumed and no second session can be created; grant only the precise permission Stripe identifies after owner review. The webhook handler itself needs no Stripe API key permission.
5. Record one signed test-only approval per merchant. Use the exact IDs and SHA-256 key fingerprints shown by the privileged Stripe diagnostic; independently observe the current Dashboard account holder. Keep the private signing key offline. `observedAccountHolder` and evidence references are server-side approval data and must not contain customer details.

Approval JSON shape (use the exact fourteen fields and no others). The observed Stripe account holder must be `Keenan Freer`; this is an owner-observed Dashboard fact recorded for the test and is not independent API/legal-entity verification:

```json
{
  "version": 1,
  "purpose": "r12_controlled_live_payment_test",
  "entity": "madhouse_franchise",
  "accountId": "acct_FROM_THE_DASHBOARD",
  "observedDashboardName": "Madhouse Gym Rotherham",
  "observedAccountHolder": "Keenan Freer",
  "legalEntityTransition": "pending",
  "legalEntityVerified": false,
  "apiKeyFingerprint": "64_CHARACTER_SHA256_FROM_DIAGNOSTIC",
  "amountMinor": 100,
  "currency": "GBP",
  "approvedAt": "2026-10-22T12:00:00.000Z",
  "approvedBy": "OWNER NAME",
  "evidenceReference": "internal-dashboard-review-reference"
}
```

For the second record use `entity: madhouse_products_services` and `observedDashboardName: Madhouse Gym Carlton`. Do not set legal transition to complete or `legalEntityVerified` true. On the secured owner workstation, sign each JSON file with the existing offline Ed25519 private key:

```sh
node scripts/sign-stripe-live-test-approval.mjs madhouse_franchise franchise-test-approval.json /secure/offline/stripe-binding-private.pem
node scripts/sign-stripe-live-test-approval.mjs madhouse_products_services products-test-approval.json /secure/offline/stripe-binding-private.pem
```

Set only these new server-side Vercel Production variables (approval JSON and signature values), alongside the already configured `STRIPE_ACCOUNT_BINDING_PUBLIC_KEY`:

- `STRIPE_FRANCHISE_LIVE_TEST_APPROVAL`
- `STRIPE_FRANCHISE_LIVE_TEST_APPROVAL_SIGNATURE`
- `STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL`
- `STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL_SIGNATURE`

Do not print or paste these values into source control, logs, tickets or chat. The app checks the signature, exact entity, configured account ID, current dashboard label, key fingerprint, £1/GBP limit and pending legal state. This operator attestation establishes only the approved destination for this test; it does not independently verify Stripe's legal entity or complete either company transition.

## Owner's manual run

1. Deploy the approved code and apply migration `2027-01-18-controlled-stripe-live-tests.sql` after backup and migration preflight. Do not execute another migration as part of this code change.
2. Visit `https://app.r12.live/club/launch-readiness/stripe/live-test` signed in as the Madhouse Club Owner, not a reviewer or staff account. Confirm both normal live Checkout gates still show disabled and both approvals show verified.
3. The Madhouse owner or authorised gym_admin initiates the Franchise session using **Authorised admin: create £1 Madhouse Franchise hosted Checkout**. The account owner must personally complete payment with their own card. Before entering a card, verify Stripe-hosted Checkout identifies the account currently labelled **Madhouse Gym Rotherham**. If the destination label/account appears wrong or ambiguous, stop and do not pay. Complete one £1 purchase only.
4. Return to the results screen and wait for the `/api/webhooks/stripe` event to show a completed session, paid £1.00 GBP, PaymentIntent, and reconciled event ID. The success redirect is not evidence.
5. Repeat once by clicking **Authorised admin: create £1 Madhouse Products & Services hosted Checkout**. Before paying, verify Stripe-hosted Checkout identifies **Madhouse Gym Carlton** as the receiving account. Complete one £1 purchase only, then wait for `/api/webhooks/stripe/products-services` reconciliation.
6. Stop when both rows show PASS. Each merchant has a permanent unique test row; the app cannot create a replacement session or payment. If either test fails or remains incomplete, do not attempt a second payment; review Stripe Dashboard and the stored safe failure classification.

The application caps each merchant at one £1 session and has only two merchant slots. It records only Checkout/payment references, state and safe failure categories. Webhook event IDs are unique; duplicate delivery is idempotent. No automated check creates any live Stripe resource. The authorization is for these two manual purchases only.

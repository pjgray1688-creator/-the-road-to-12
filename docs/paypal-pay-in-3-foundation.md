# PayPal checkout (disabled until merchant setup)

PayPal checkout is integrated for the approved one-off Madhouse transformation packages and annual membership. It is deliberately unavailable unless `R12_PAYPAL_PAY_IN_3_ENABLED=true`, the server credentials and webhook ID are configured, and the Madhouse merchant readiness row is enabled with PayPal and accountant approval. The public joining form only shows PayPal where the product code and all readiness gates match.

PayPal determines at its own checkout whether Pay in 3 is available for a buyer and transaction. R12 does not assert or guarantee financing eligibility. A buyer can still complete another PayPal funding option if PayPal presents one. R12 creates one GBP PayPal capture; it does not create an instalment schedule.

## Payment flow

1. An authenticated, email-verified member saves the ordinary Madhouse joining request.
2. A server-only RPC verifies the request owner, immutable product code, persisted amount, GBP currency, current entitlement snapshot and approved Franchise merchant, then creates an idempotent local order intent.
3. The server creates a PayPal order using the Franchise merchant ID and a stable `PayPal-Request-Id`. The browser receives only the provider approval URL.
4. Browser return triggers an authenticated server-side order retrieval and capture. A browser redirect alone never marks payment successful.
5. The PayPal webhook endpoint verifies the transmission with PayPal's signature-verification API, retrieves provider state, and reconciles amount, GBP currency, merchant and capture ID. Capture and the existing Club membership/entitlement grant are committed atomically and idempotently.
6. Failed/voided events leave membership inactive. Browser cancel/return is not treated as verified payment or as proof a provider cancellation occurred.

Endpoint: `/api/webhooks/paypal/pay-in-3`. Configure this exact URL in both the PayPal sandbox and live apps as appropriate, subscribe to `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, and `PAYMENT.CAPTURE.DENIED`, and use the corresponding webhook ID.

## Required server configuration

- `PAYPAL_CLIENT_ID`: client ID from the Madhouse Franchise PayPal app.
- `PAYPAL_CLIENT_SECRET`: server-only secret from that same app; never use a `NEXT_PUBLIC_*` name.
- `PAYPAL_WEBHOOK_ID`: webhook ID from the same app and environment.
- `PAYPAL_ENVIRONMENT=sandbox` for non-production test environments; `PAYPAL_ENVIRONMENT=live` in production.
- `R12_PAYPAL_PAY_IN_3_ENABLED=false` until sandbox end-to-end verification and merchant/accountant approval; only then may it be explicitly enabled.
- The Madhouse row in `club_paypal_pay_in_3_settings` must have legal entity `17383077`, the approved merchant ID for that environment, `paypal_approved=true`, `accountant_approved=true`, and `enabled=true`.

Never copy credentials between sandbox and live apps. Live credentials and the live webhook ID are currently absent from this environment. This release has not created an order or charged a payment. The follow-up migration `2027-01-13-paypal-pay-in-3-checkout.sql` must be validated and approved before deployment.

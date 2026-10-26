# Multi-app authentication release actions

These are reviewed configuration actions. They are not performed by the web deployment or a database migration.

## Supabase URL configuration

- Set **Site URL** to `https://app.r12.live`.
- Add `https://app.r12.live/auth/callback**` to **Redirect URLs**.
- Add `https://app.r12.live/account/reset**` to **Redirect URLs**.
- Retain only intentional local/preview patterns. For local testing, use `http://localhost:3000/**`. For Vercel previews, use the narrow team pattern rather than a global hostname wildcard.
- Do not add the custom iOS schemes as Supabase redirect targets. Verification is completed on the HTTPS origin; the continuation page may then open an already-registered app scheme.

An unallowlisted `emailRedirectTo` is silently replaced by the Supabase Site URL, which is why affected confirmations landed on the Training home page.

## Confirm-signup email

In **Authentication → Email Templates → Confirm signup**, use the subject:

```text
Confirm your {{ if eq .Data.origin_app "glow" }}Glow Zone{{ else if eq .Data.origin_app "club" }}R12 Club{{ else if eq .Data.origin_app "coach" }}R12 Coach{{ else }}R12 Training{{ end }} account
```

Use the HTML in [`supabase-confirm-signup.html`](./supabase-confirm-signup.html). The template uses the stored, validated `origin_app` and `auth_return_to` metadata and sends the token hash to the server confirmation endpoint. The endpoint validates the token and revalidates the destination before setting the session cookie.

Send test messages for all four `origin_app` values after saving the template. Configure a production custom SMTP provider, disable provider link tracking, and verify SPF, DKIM and DMARC before release; Supabase's default SMTP service is not suitable for customer delivery.

## Database changes to review and apply

Apply through the normal migration runner after review and preflight—never by pasting into production blindly:

1. `2026-10-20-account-deletion-requests.sql` (currently omitted from the old ordered manifest; required for deletion request/status RPCs).
2. `2027-01-21-glow-customer-self-registration.sql` (verified-email exact-match linking or standalone Glow Zone customer creation; no membership/access/credit grant).

After each migration, confirm its checksum and success in `public.r12_schema_migrations`, then run the non-mutating RPC privilege checks. Use disposable test accounts for the mutation tests described in the release checklist.

## Post-deployment release checklist

Run these checks only after the reviewed migrations and Auth settings above are present in the target environment:

- Register a disposable address from Training, Club, Coach and Glow Zone. Confirm the page and email brand, then confirm each link returns to that product rather than Training.
- Open one confirmation link twice and open one deliberately expired link. Confirm both fail safely with branded recovery guidance and no unrelated navigation.
- Confirm the verified browser session continues automatically. From a different browser/device, confirm the web and native continuation choices lead to the originating product and allow normal sign-in.
- Sign in as an existing Madhouse-linked customer and confirm the customer, membership, minutes and activity remain attached.
- Sign in as a new Glow Zone customer and use **Set up Glow Zone**. Confirm a standalone customer is created without a gym membership, access grant, credit or payment record.
- Submit deletion for one disposable account in each brand with a wrong password, a missing `DELETE`, and valid credentials. Confirm failure states reveal no account details; confirm valid requests are idempotent and visible only to that account.
- Process the disposable deletion requests through the authorised retention workflow. Confirm retained transaction/audit records are preserved or anonymised according to policy, and confirm no other identity, membership or subscription is changed.
- Confirm a shared account can still enter each product for which it is authorised. Account deletion is shared-account deletion; it is not gym-membership cancellation and must not silently cancel an active subscription.

## iOS

The web/backend release fixes branding, redirect safety, callbacks, account setup and deletion. A new binary is required only for the native tab restoration fix in `RouteWebScreen.swift`; it makes a tab redirected to Account reload its intended Home/Use/Buy destination after authentication. Existing builds still receive the web fixes but can retain a redirected page in a tab until it is manually reloaded.

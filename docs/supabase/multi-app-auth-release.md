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

Use the HTML in [`supabase-confirm-signup.html`](./supabase-confirm-signup.html). Hosted Supabase Auth evaluates the body as a Go HTML template; `.Data` is the signup `user_metadata`, and conditional `if`/`else if` blocks provide the four app-specific identities. The link uses `.SiteURL`, `.TokenHash` and the stored `origin_app`/`auth_return_to` metadata. It opens a branded confirmation page first; only the person's explicit POST consumes the token. The server then validates the token and revalidates the destination before setting the session cookie. This two-step design avoids consuming a one-time token when an email-security service merely prefetches the link.

Send test messages for all four `origin_app` values after saving both the subject and body. Confirm the hosted dashboard renders, rather than prints, the conditional subject; if that project version does not template subjects, use the neutral subject `Confirm your R12 account` while retaining per-app branding in the supported HTML body. Configure a production custom SMTP provider, disable provider link tracking, and verify SPF, DKIM and DMARC before release; Supabase's default SMTP service is not suitable for customer delivery.

## Database changes to review and apply

Apply through the normal migration runner after review and preflight—never by pasting into production blindly:

1. `2026-10-20-account-deletion-requests.sql` (currently omitted from the old ordered manifest; required for deletion request/status RPCs).
2. `2027-01-21-glow-customer-self-registration.sql` (verified-email exact-match linking or standalone Glow Zone customer creation; no membership/access/credit grant).

The `2027-01-21` name is an ordering identifier, not a claim that the change was deployed on that calendar date. The existing manifest already runs through `2027-01-20`; this file takes the next slot so it cannot run before `club_customers`, `club_audit_events`, profile names, `club_location_service_hours`, and the existing Glow read/pricing boundary. No existing migration or function uses `club_glow_ensure_customer`.

Before running anything, query `public.r12_schema_migrations` and confirm the checksums of every recorded predecessor. The Glow migration requires the manifest chain through `2027-01-20-glow-zone-pricing-and-account-read.sql`; do not apply it alone to a production schema that is missing intermediate entries. Preflight `to_regclass` for `club_organisations`, `club_customers`, `club_audit_events`, `club_location_service_hours`, and `profiles`, plus `to_regprocedure` for the existing public-organisation and Glow account-read functions. The migration is transactionally applied by the runner, uses a safe `search_path`, verifies `auth.uid()` and confirmed email, refuses missing/ambiguous/already-owned matches, preserves existing customer and membership rows, writes only the customer link or a new standalone customer plus an audit event, and grants execution only to `authenticated`.

The deletion migration is independent of Club membership/payment tables and is already in the runner's atomic list. Its request tables have RLS enabled with no direct client table grants. The own-status RPC scopes by `auth.uid()`; submission/list/processing RPCs require the service role. It records and audits a queue but does not delete an Auth identity or application data.

After each migration, confirm its checksum and success in `public.r12_schema_migrations`, then run the non-mutating RPC privilege checks. Use disposable test accounts for the mutation tests described in the release checklist.

## Business boundaries and deletion compliance

- One Supabase identity is the shared R12 account. App context changes branding and the safe return destination; it does not create four identities.
- Club staff access is an organisation role/capability assignment controlled by authorised management. Suspending it must not remove the Auth identity or alter `club_memberships`, membership holders, billing obligations or provider agreements.
- Gym membership cancellation is a separate audited Club workflow. It requires authorised membership and payment-provider operations plus confirmation; this release adds no GoCardless or cancellation behaviour.
- Account deletion currently records an authenticated, reverified request in a restricted operator queue. The operator can record review and attest that eligible data was processed elsewhere, but the repository has no executor that erases/anonymises all eligible application data and removes the Supabase Auth user.
- Therefore Apple submission remains blocked until an accountable operator, complete data inventory, approved retention schedule, repeatable deletion/anonymisation procedure, Auth-user deletion step and out-of-band completion confirmation are operationally verified. Manual processing can comply, but a queue plus unchecked attestation cannot by itself demonstrate deletion.

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

## Exact release sequence

1. Integrate commit `d9d52a5` plus the final review commit into the intended release branch, resolve against its current head, rerun focused auth/deletion/migration checks, then push that release branch. Do not merge directly to production without review.
2. Read the production migration ledger and schema preflight. Apply every missing manifest entry in order through the reviewed runner; specifically verify the deletion migration and the complete predecessor chain before the `2027-01-21` Glow migration. Verify checksums, function owners, grants and RLS after application.
3. Add the production Site URL, narrow callback/reset redirect allowlist and custom SMTP settings in Supabase. Prepare the tested conditional confirmation subject/body, but do not activate a template that links to `/auth/confirm` until that route is deployed, unless registrations are paused for the change window.
4. Deploy the reviewed web commit. Verify `/auth/confirm` and `/auth/verify` on production, then activate the email template immediately and send one message for each app context. Verify sender authentication and that tracking does not rewrite links.
5. On physical iPhones, test the existing TestFlight builds against production: four-app registration/verification/return, expired and replayed links, restored sessions, existing linked customer, new Glow customer, deletion submission/failure/status, and cross-app shared-account effects.
6. Because existing iOS builds can retain a redirected Account page in a tab, archive all affected iOS targets from the integrated commit, complete unsigned/release validation and App Store metadata review, then submit new builds only after the physical-device matrix passes.
7. Run Android configuration validation and build all four Android variants from the same web revision. On physical/emulated Android, repeat registration, App Links/web callback, session restoration, Glow navigation and deletion regressions before promotion.

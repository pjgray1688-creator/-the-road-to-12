# Four-app privacy policy audit

Audit date: 20 October 2026

This records what the source repository supports and what remains unverified. The four public-route components are drafts until the owner decisions below are made; source code alone cannot establish the controller's legal identity, Article 6/9 decisions, processor contracts or actual production configuration.

## Proposed app policy URLs

- R12 Training: `https://app.r12.live/privacy`
- R12 Club: `https://app.r12.live/club/privacy`
- R12 Coach: `https://app.r12.live/coach/privacy`
- Glow Zone: `https://app.r12.live/glow-zone/privacy`

The first route keeps the existing policy URL. The other three have their own App Router pages and canonical metadata. These URLs are proposals; the deployment/reverse-proxy route for `/privacy` is not confirmed in `docs/r12-launch-configuration.md` and production has not been deployed.

## Evidence reviewed

- `app/privacy/page.tsx` was a single pre-launch notice with a development-placeholder contact and no app-specific detail.
- `docs/android-play-release-plan.md` says all four apps use separate shells/routes and identifies the per-app categories that need Data Safety disclosures. It also says the developer identity and verified privacy contact were unresolved.
- `ios/AppStoreConnect/DeletionAndInductionDeployment.md` says `lib/legal.ts` contains a development placeholder; sender addresses are not verified support contacts. The deletion flow creates a restricted request and audit event; it does not erase the Auth identity or business records. It records a one-calendar-month response deadline, but the accountable privacy operator, process, completion commitment and contact channel are unapproved.
- `docs/integrations.md`, `lib/whoop-server.ts`, `lib/whoop-sync.ts` and the WHOOP migration establish an optional OAuth integration design. The integration doc says it does not claim a connection until provider configuration is completed. Apple Health needs a future native bridge and must not be described as active.
- `docs/r12-launch-configuration.md`, `lib/stripe-merchant.ts`, and the Stripe/GoCardless/PayPal provider routes establish code paths and separate merchant configurations. The documented Stripe accounts belong to Madhouse Franchise Limited (company number 17383077) for membership and Madhouse Products and Services Limited (company number 17383213) for products/services. This evidence identifies merchants for those payment flows; it does not establish those companies' controller/processor roles for every app record.
- Club migrations and `lib/club-*` code show organisation-scoped member, staff, access, membership, induction, attendance, purchase, balance, audit and Glow Zone records. Coach migrations and `app/api/coach/*` show permissioned client relationships, programmes, sessions and nutrition/accountability functions. These technical boundaries show who can access records in the app, not who made the legal controller decision.
- `glowzone-website/lib/site.ts` and `docs/PRIVACY-DECISIONS.md` identify Madhouse Products and Services Limited (company number 17383213) as Glow Zone's legal website operator, and `contact@madhousegym.online` as a shared confirmed privacy mailbox for that company and Madhouse Franchise Limited. The Glow Zone privacy decisions explicitly say that the operator fact does not establish controller/processor roles for each activity. The mailbox is therefore used only on the Glow Zone draft; no R12-wide privacy email is asserted.
- Supabase Auth/Postgres and Vercel hosting are present in app code/configuration. Repository evidence does not include executed DPAs, actual production Vercel/Supabase settings, data-region/log retention configuration, or a confirmed subprocessor and transfer list. The drafts distinguish configured technical services from legally confirmed processor relationships.
- The ICO says a controller must provide the lawful basis, recipients, retention information and relevant rights, and that processing special-category health data requires both an Article 6 basis and a separate Article 9 condition. The R12 repository does not record a verified, product-wide Article 9 condition or explicit-consent flow.

## Remaining owner decisions before publication

1. Name the legal controller for each activity in each app, including standalone R12 Training account/training data, Club gym/member/staff/financial records, Coach-client/nutrition records and Glow Zone minute/age/session records. Confirm any joint-controller arrangement.
2. Confirm the legal operator of the R12 platform and whether it acts as a processor, independent controller or joint controller for each category. Approve and execute the relevant processor/data-sharing terms; do not infer the relationship from the product name or merchant account.
3. Approve the Article 6 basis per purpose and controller. Before health/recovery/nutrition/safety information is processed, identify the applicable Article 9 condition (and any required DPA 2018 safeguards), and verify that any consent language and withdrawal flow match it.
4. Approve a record-specific retention schedule or objective criteria covering account/profile, training/WHOOP data and tokens, coaching/client notes, membership/attendance/access, inductions and age checks, Glow Zone sessions/minutes, transactions, staff/audit/security logs, support requests and deletion requests.
5. Name the operational privacy/deletion owner; confirm who can process requests, how non-deletion rights are handled, how completion is confirmed, and what controller-specific contact details users should use. The existing queue is not self-executing and is not a general privacy-rights request form.
6. Confirm live provider usage and recipients, including WHOOP enablement, Stripe/GoCardless/PayPal availability by app, email provider, Vercel and Supabase account ownership, DPAs/subprocessors, data regions/log retention and international-transfer safeguards. Remove any provider from the notice if it is not used in production.
7. Confirm app-host routing so all four proposed URLs are public on `app.r12.live`; current launch configuration calls out that `/privacy` routing must be checked against the marketing site. Confirm no route collision for the three app-specific paths.

## Reference

- [ICO: What privacy information should we provide?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)
- [ICO: Special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data)
- [ICO: Controllers and processors](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/what-are-controllers-and-processors/)

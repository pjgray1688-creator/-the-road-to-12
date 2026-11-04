# Madhouse Website Shop · Stage 1

This change adds a separate publication layer over existing R12 commerce products. It does not change member-shop selling prices, product costs, Stripe configuration, or promotion logic.

## Database release

The R12 deployment guide's primary path first applies `supabase/deployment/2026-11-22-madhouse-final-state-reconciliation.sql`. Apply `supabase/migrations/2026-11-04-madhouse-website-shop.sql` as a separate forward step after that baseline; the launch migration manifest also includes it for the optional runner. Do not execute it from an application route. The Postgres validation workflow applies the forward migration after the canonical baseline and checks its RLS and grants.

## Website Shop controls and size availability

The follow-up migration `supabase/migrations/2026-11-04-madhouse-website-shop-controls.sql` adds website-only enabled sizes and family visibility, installs the manager RPCs, replaces the public catalogue RPC, and idempotently reconciles the 21 approved Madhouse mappings. The original Website Shop migration has already been applied and must not be rerun for this update.

Before deploying the updated Club and Madhouse website application code, execute the complete contents of `2026-11-04-madhouse-website-shop-controls.sql` once in the production Supabase SQL Editor. It is transactional and may be re-run safely if a SQL Editor connection fails before commit. Confirm the editor reports success. Then deploy the R12 Club application and the public Madhouse website through their existing Vercel projects. Do not enable checkout; this migration does not create payment sessions or touch Stripe/member pricing.

The migration creates a manager-only publication table, a capability-checked save RPC with audit events, and a narrow anonymous read RPC. Anonymous callers can receive only explicitly published, available, and mapping-verified product fields; product and organisation IDs, costs, and customer data are not returned. Publication and availability default to off. The database also rejects publishing until an authorised manager confirms the R12 product, colour, and photos match the showroom entry.

The confirmed organisation is `fa44592a-1593-4ad3-a621-63a4a4bcbceb`. The code contains proposed mappings to these existing product families: Heavy Oversized T-Shirt (`fccc70d5-2db2-45ab-be4f-3cd728c28aa8`), Pullover Hoodie (`912a3ec3-c8cc-48c0-9d20-9223584d0714`), and Crewneck Sweatshirt (`7f1116bb-2d32-408b-ac66-ac7cde04170b`). It resolves variants by family and catalogue colour; it does not guess or store per-size product UUIDs.

The supplied read-only production catalogue report states £25.00 for tees and £35.00 for hoodies and sweatshirts. These values are not hardcoded as website or checkout prices. Club reads current `sell_price_minor`; public output uses that value only when all eight active sizes have the same valid price, or uses the separately managed website override.

The Club page presents all 21 suggestions and preselects a match only when that exact family/colour exists in the organisation's live catalogue. These are proposed matches, not seeded or published records. Save each reviewed match through Club's authenticated save action; its organisation/slug upsert is repeatable and writes an audit event with the manager as actor. The initial state is unpublished and unavailable. Confirm garment/photo identity before enabling both availability and publication. In particular, explicitly review Black/Grey tee vs Black, Cream hoodie vs Beige, Green vs Forest Green, Brown sweatshirt vs Chocolate Brown, and Grey sweatshirt vs Light Grey. The UI calls out each discrepancy and the RPC prevents unverified publication.

A website price override is separate from the member-shop price. Leave it blank to use the R12 price only when exactly the eight expected active sizes exist and all have the same valid non-null price. Otherwise enter a website-specific price after review. No inventory counts are inferred; apparel is made to order.

## Madhouse website configuration

Configure these server-side environment variables on the Madhouse website deployment and local runtime:

- `R12_SUPABASE_URL`
- `R12_SUPABASE_ANON_KEY`
- `R12_APPAREL_ORGANISATION_ID`

The public website uses the anonymous/publishable key only to invoke the narrow public catalogue RPC. Never set a service-role key on the Madhouse website. `.env.example` contains the confirmed project URL and organisation UUID, with the key blank. To configure local development, copy only these three `R12_*` settings into the website's ignored `.env.local`, leaving existing settings intact. For hosted configuration, ask an authorised project manager to retrieve the anon/publishable key from the confirmed production project's Supabase API settings and add it as the server-side `R12_SUPABASE_ANON_KEY` environment variable in the website host's environment settings. Do not use a key from the old test project or expose service-role credentials. Do not edit hosting settings until separately authorised.

The public promotion evaluator is not part of this stage. Monetary savings remain unconfirmed, and checkout remains disabled.

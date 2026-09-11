# Active Sports final catalogue workflow

Use **Club → Products & Pricing** (`/club/products?org=<organisation>`) with both existing `supplier.catalogue_manage` and `commerce.pricing_manage` capabilities. No service-role key or production SQL is needed to import. A file in the repository never triggers an import. The committed `reviewed-pack` and earlier `catalogue.csv` are historical review sources, not the final launch file.

## Required database setup

Apply **`supabase/migrations/2026-10-17-active-sports-pricing-reconciliation.sql`** in the Supabase SQL editor as one complete transaction, after checking deployed migration history. It depends on the existing supplier/commerce/capability migrations, particularly:

- `2026-10-13-club-supplier-catalogue-parent-variants.sql`
- `2026-10-14-club-supplier-cost-history.sql`
- `2026-10-15-club-catalogue-enrichment.sql`
- `2026-10-16-member-catalogue-enrichment-read.sql`

Do not rerun already-applied migrations. This migration adds scoped constraints, current source cost and manual-price ownership to existing offers; extends private cost history; replaces supplier retail-price saving and member catalogue reading; adds authenticated preview/reconciliation and pricing reads; guards unavailable supplier order items; and routes Active Sports away from the legacy generic importer. Existing generic supplier imports keep their original implementations behind private helper functions. No capability evaluator is replaced and no customer table permissions are expanded.

The migration has **not** been applied by this implementation. Deployed migration history could not be inspected here: no Supabase database connector, CLI, or credentials were available. Check the deployed SQL against the repository prerequisites before applying. Multiple existing suppliers named Active Sports / Active Sports Nutrition or ambiguous variant identities stop reconciliation without changing data; resolve those explicitly rather than guessing.

## Export the workbook

1. Open the positively identified **final reviewed workbook** in Excel or LibreOffice. Select the catalogue sheet containing the facts below, with one row per genuine supplier variant/order unit.
2. Keep Supplier SKU and Barcode as **text**, preserving leading zeros and avoiding scientific notation. Dates should be ISO `YYYY-MM-DD` or ISO timestamps. Formula cells must export their calculated values.
3. Save only this sheet as **CSV UTF-8, comma-delimited** to `/tmp/active-sports-final.csv`. Preserve CSV quoting around commas, quotes and multiline descriptions. Exporting to CSV requires no new XLSX dependency.
4. Review the CSV header, row count, SKU/barcode strings and a known VAT-free item before continuing. Files must be below 8 MB and 10,000 rows for the authenticated page; do not split a full snapshot into smaller production imports, since absent variants are retired.

Required headers (optional factual values may be blank):

```text
Supplier,Brand,Parent Product,Category,Subcategory,Description,Size / Format,Variant / Flavour,Pack Qty,Member Order Unit,Supplier Stock,Stock Checked,Supplier SKU,Barcode,Source URL,Notes,Parent Image URL,Variant Image URL,Image Status,Trade Cost ex VAT,VAT Rate,Cost Source / Snapshot
```

Required row values: supplier (`Active Sports` or `Active Sports Nutrition`), brand, parent product, category, size/format, member order unit, supplier stock, stock checked, trade cost and cost source/snapshot. Flavour, SKU, barcode, descriptive fields and images may be blank. A supplied barcode must contain 8–14 digits. `Pack Qty` must be a positive integer and is required for `case`, `box` or `pack`; a blank pack quantity on another unit means one. Units: `unit`, `each`, `tub`, `case`, `box`, `pack` (case-insensitive).

Trade cost is a non-negative GBP amount with at most two decimal places, optionally prefixed `£`; no thousands separators, currency prose or scientific notation. `VAT Rate` accepts `20`, `20%`, fractional `0.2`, `0`, `0%`, or `VAT FREE`; other explicit rates from 0–100% are retained. A fractional value between 0 and 1 means a fraction; use `%` to explicitly express a sub-1-percent rate. Blank VAT defaults to 20%; explicit VAT FREE or zero stays zero. A conflicting optional VAT Treatment is rejected. No derived retail columns are required or used for publication.

Supplier Stock must be `In stock` / `Out of stock` (aliases `available` / `unavailable` accepted). Unknown or missing stock cannot publish. The importer retains unavailable siblings of an available parent, skips new wholly unavailable parents, and deactivates previously imported parents that have become wholly unavailable or disappeared from the full snapshot. This does not delete cost history or local stock.

## Validate, compare, confirm

Run the local validation command:

```bash
npm run active-sports:dry-run -- /tmp/active-sports-final.csv /tmp/active-sports-report.json
```

In an environment which blocks the `tsx` CLI's IPC socket, the equivalent is:

```bash
node --import tsx scripts/active-sports-dry-run.ts /tmp/active-sports-final.csv /tmp/active-sports-report.json
```

The command exits nonzero for rejected rows, duplicates or empty input and prints/writes source and retention counts, available/unavailable variants, missing commercial data, and VAT counts. It is deliberately offline and cannot invent create/update counts without the live catalogue.

Next, in **Products & Pricing → Supplier products & pricing → Import reviewed Active Sports catalogue**:

1. Select the **same** final CSV and click **Validate & compare**. This reparses on the server and calls the authenticated database preview without writing anything.
2. Review all counts, including creates, updates, unchanged variants, cost/stock changes, products becoming unavailable, preserved manual prices and pricing-review flags. Correct every rejected row and duplicate before proceeding. This is a **full snapshot**, not a partial cost patch.
3. Tick the review acknowledgement, then click **Confirm import & publish available catalogue**. One transaction validates again, reconciles the existing supplier/parent/variant records, records costs, creates any needed canonical supplier sales units, updates availability and publishes the successful result. An intervening catalogue or price change invalidates the preview; compare again.
4. Read the result counts and verify the Member Shop. Repeating the same CSV through compare/confirm creates no duplicate variants or cost changes. A batch receipt records each explicit import attempt that commits.

Identity uses supplier SKU first, barcode next, and exact brand/product/size/flavour/pack/order-unit facts otherwise. Conflicting references fail closed. With no stable identifiers, a changed product identity must be reviewed: it may appear as a new variant while the old variant is retired. The importer does not hard-code brand or catalogue counts.

## Pricing and stock contracts

Current supplier trade cost and VAT remain private. R12 rounds unrecoverable VAT-inclusive cost to integer pennies, then calculates `ceil(true_cost_minor / 70) * 100` as the upward whole-pound floor for 30% gross margin. A zero-cost row may be retained but cannot be ordered until it has a positive live price.

Existing priced offers are conservatively marked manual when the migration is applied. New unapproved prices track R12's floor. Once management saves a price, future imports preserve it and recalculate the floor/review warning. Price changes update the canonical checkout price and retain actor/timestamp evidence in existing price history. The detail view previews margin and asks for explicit confirmation, including a warning below the floor.

Supplier costs are corrected through a **full reviewed source refresh**, with a new source note. This keeps imported current cost authoritative and avoids a competing manual-cost override that the next supplier refresh would erase. The pre-existing history-only cost-evidence function remains authorised and has stronger organisation checks; it does not overwrite current imported cost.

Golden Ticket headroom uses the existing 20% calculation as a labelled planning scenario. Merchant fees use the existing pricing calculator with an explicitly entered allowance; no unknown Stripe rate is invented. The existing checkout promotion engine still determines eligibility/stacking and retains its existing snapshots.

A supplier case/box price always buys that case/box. New supplier sales units are non-stock-tracked canonical commerce products. A pre-existing local product link is retained separately when a dedicated supplier order unit is needed. Supplier imports never insert, update or delete local inventory or stock movements. Management shows local stock across venues separately from supplier availability. Customers receive a field-selected catalogue without costs, VAT, margin, history or review flags; unavailable sibling options are visible but disabled, and the database order-item guard also rejects them.

## Regression verification

```bash
node --import tsx --test tests/active-sports-launch.test.ts
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

`tests/sql/active-sports-launch.sql` exercises the actual reconciler, authorisation, manual price persistence, history, repeated import, member-safe reads, unavailable checkout and local POS in a rollback transaction. It requires a **disposable local database** with repository migrations applied; never point the regression fixture at production.

```bash
R12_TEST_DATABASE_URL=postgresql://localhost/r12_test node --import tsx --test tests/active-sports-database.test.ts
```

Without a configured local PostgreSQL database this integration test is explicitly skipped, not reported as a pass.

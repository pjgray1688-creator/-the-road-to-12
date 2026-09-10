# Active Sports catalogue import

Place the reviewed export at `data/active-sports/catalogue.csv` (or pass an explicit path). The CSV must contain the 19 headers exported by `ACTIVE_SPORTS_HEADERS`; optional commercial columns are accepted by `parseActiveSportsCommercialFields`.

Run a non-destructive review report:

```bash
npm run active-sports:dry-run -- data/active-sports/catalogue.csv data/active-sports/reconciliation-report.json
```

This command only parses and reports. It does not contact Supabase, write catalogue rows, or publish products. Publication remains deliberately off until management reviews the generated JSON and a later authenticated reconciliation action is run.

Strong identity is supplier + SKU/barcode with parent/variant fields as deterministic fallback. Supplier case/box order units remain explicit; variant imagery is validated and falls back to a validated parent image. Missing costs, VAT review, unavailable stock, duplicate identities, and missing/rejected imagery are reported for management review.

# Active Sports reviewed import pack

Prepared 2026-09-10 from the captured Active Sports trade catalogue.

- `catalogue.csv` contains 3,531 unique variants using the repository's required 19 catalogue fields plus supported commercial columns.
- 1,796 variants have source-matched trade costs: 82 VAT-free and 1,714 standard-rated.
- 1,735 variants remain without a confirmed trade cost.
- Seven duplicate source rows were merged. Four stock conflicts were set to Unknown so they cannot be ordered until checked.
- `pricing-review.csv` contains 492 product-size groups that still need review.
- Only two rows currently have image URLs. Customer publication must remain disabled for missing or rejected images.
- `validated-reconciliation-report.json` verifies the commercial columns using the repository's existing commercial parser. It found no economics parsing/calculation errors.
- `committed-dry-run-report.json` records the current committed dry-run result. Its zero fully-costed count is a checker defect: the committed script normalises catalogue fields but does not attach the supported commercial fields before producing its report.
- `possible-product-aliases.json` flags differently named catalogue groups matching the same supplier listing.
- `merged-source-rows.json` records the duplicate consolidation.

The suggested retail column is a 30% gross-margin floor on VAT-inclusive cost, rounded up to the next whole pound. It is not an approved live price. `Final / Live Retail` remains empty.

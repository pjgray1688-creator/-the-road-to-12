# Madhouse POS sellable units and PT packages

The reception till and Member shop share the existing commerce product, order, payment and stock-ledger model. A stockable product's balance is maintained per existing Club location, so Rotherham and Carlton remain separate. Staff stock-in, reasoned adjustments and waste/removal continue to use the audited inventory ledger; checkout does not silently permit stock below zero.

## POS sellable units

Products can be enabled for Reception POS, the online shop, or both. These channel flags are checked again by the database when order lines are written. A single retail item (for example, one can) is its own sellable product and its own counted stock unit. It can optionally point to a canonical local supplier/case product and record the number of singles in one source pack. The supplier catalogue row and its supplier order unit are not rewritten. Reception stock is counted in the actual item sold; receiving a supplier case does not automatically convert its quantity into individual sale units.

POS stock uses the existing `club_stock_movements` and `club_stock_reservations` records. Staff checkout reserves each location's stock through the existing advisory-lock reservation RPC before recording cash, Balance or split tender. The final paid-order transaction writes the stock sale movement and fulfils that reservation. If reservation fails, the pending sale is cancelled. Locations must be selected from the organisation's existing `club_locations`.

## Service products and PT packages

A non-physical service product uses the existing `club_services` and `club_service_transactions` tables. Management can configure a PT product's selling price and, optionally, its session count and expiry window; no sample price or package is preconfigured. A completed paid purchase with a linked Member/customer grants an expiry-aware lot in `club_service_credit_lots`. Its idempotency reference is derived from the unique commerce order line, so retries do not grant credits twice. Credits remain distinct from membership/access entitlement and stored value.

Members see their own unexpired PT package session balances on Order History. An assigned Coach can see the remaining session count and expiry in the authorised Madhouse client workspace; no price or payment details are exposed. Private/guest purchases can be associated with a customer record without creating an Auth identity; once that customer is linked to an account, the customer-scoped RLS rule can expose the balance to that account. Package credits are not yet consumed automatically by completed PT appointments: Coach completion, customer linkage and package selection need a deliberate operational rule before consumption is enabled. No Coach financial or package-administration screen is introduced here.

Retail order lines keep product name, SKU, quantity and price snapshots, so later catalogue changes do not rewrite receipts. Cash and Madhouse Balance remain the supported POS payment paths; this change does not claim card-terminal support or alter recurring membership billing.

# Club operational go-live checklist

This repository contains the operating UI and provider-neutral data contracts. No provider is treated as connected until Madhouse supplies credentials and an approved merchant account.

## Revenue boundary

R12 digital subscriptions (including future Apple/Google subscriptions) are platform revenue. Gym memberships, shop, PT, services, cash and Madhouse Balance are Club revenue. Keep these ledgers separate in reporting.

## Supplier and member imports

Supplier and member exports are untrusted files. Upload → map columns → validate → review duplicates/conflicts → import through an authorised server boundary. Supplier availability never changes Carlton/Rotherham on-hand stock. Member imports create business records only; they never create passwords, auth users or successful payments.

`parseSupplierCsv` and `parseMemberCsv` provide deterministic CSV parsing for the first review step. XLSX support and the final authorised import action require an agreed file library and production capability decision.

## Provider readiness

Cash and Madhouse Balance use existing transactional Club boundaries. Card, Klarna, Clearpay, PayPal, direct debit, email/SMS/WhatsApp and Printify remain unavailable until configured. Local eligibility must never be interpreted as provider approval.

## Demo reset before launch

Do not delete a tenant wholesale. First inventory Madhouse orders, payments, cash declarations, balance entries, stocktakes/movements, supplier demand and collection records; classify each as genuine or demo; obtain owner approval; then reset only confirmed demo transactions while preserving products, prices, memberships, people, roles and entitlements. Establish real opening counts independently at Carlton and Rotherham and verify balances and audit history afterwards.

## Native packaging direction

Keep the Next.js web/PWA as the shared product surface. A later Capacitor-style shell can share Member/Club/Coach domain code while using separate application IDs, deep-link routes and native camera/push adapters. Recommended store strategy is separate Member and Club listings (with Coach evaluated separately) so permissions, review disclosures and release cadence remain clear. Apple Developer/App Store Connect and Google Play Console accounts, signing, privacy declarations, store assets, TestFlight/internal testing and R12 subscription products are external prerequisites.

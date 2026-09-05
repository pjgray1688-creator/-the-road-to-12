# R12 repository instructions

## Product boundaries

R12 is a production Next.js application with three cohesive surfaces: Member (training and consumer experiences), Club (multi-tenant gym operations), and future Coach/Nutrition capabilities. `app/` contains App Router pages and server boundaries, `components/` contains UI, and `lib/` contains domain types, repositories, deterministic logic, and storage adapters. Keep Member training changes separate from Club commerce unless explicitly requested. Preserve schedule/occurrence identity, workout persistence, preview isolation, WHOOP/progress behaviour, and auth/deep-link contracts.

Madhouse-specific behaviour belongs in tenant configuration/data, not generic domain logic. Keep R12 digital subscriptions/revenue separate from gym/Madhouse commerce and stored value.

## End-to-end delivery rule

When a task is repository-fixable, complete its requested vertical end-to-end: persistence, authoritative server boundary, UI, security, and regression tests. Do not stop at types, migrations, helpers, shells, or “foundation” when acceptance criteria remain implementable. Check every acceptance item before handoff and continue if a repository-fixable item is NO. Treat only genuine external dependencies (credentials, hardware, production secrets, provider approval, or unresolved business policy) as blockers, and state them precisely.

Prefer a small complete slice over broad unfinished architecture. Do not expand scope into unrelated Member, Club, or Coach work.

## Product outcomes and deployed verification

Requested product behaviour is the requirement; current implementation limitations are not product requirements. Hide repository/domain implementation prerequisites from staff when the application can resolve them safely. A reported deployed failure remains unresolved even when tests pass: trace the real runtime boundary and add regression coverage for the discovered cause.

## Production and data safety

The repository is connected to real production data. Never execute production Supabase SQL, run migrations, mutate live records, fabricate provider/hardware responses, or create demo transactions unless the current task explicitly authorises it. Migrations are reviewed repository artifacts; never assume a migration has run because it is committed. Do not edit an already-live migration; correct an explicitly unexecuted migration only when the task permits it.

## Server authority and integrity

Client state is intent only. Server/database code is authoritative for identity, organisation/location scope, prices, totals, sellability, stock, balances, payment, membership, entitlements, access, fulfilment, and provider eligibility. Money-, stock-, entitlement-, and fulfilment-changing operations must be transactional and idempotent where retries are possible. Never decrement stock or grant fulfilment from basket state alone.

Use existing repositories and capability infrastructure rather than duplicating domain systems. Preserve organisation isolation, member privacy, audit trails, and payment/order separation. Use integer minor units for money and validate all untrusted uploads/input at trusted boundaries.

## Database, RLS, and capabilities

Inspect deployed migration history before adding schema. Use real foreign keys, check/unique/idempotency constraints, safe delete behaviour, and organisation-scoped indexes. SECURITY DEFINER functions require an explicit safe `search_path`, `auth.uid()`/ownership checks, organisation checks, and the appropriate capability check inside the function. Revoke public/anon execution and grant authenticated execution only when the function authorises the caller itself. Never fork or casually redefine the canonical capability evaluator; preserve deny/allow overrides, owner protections, permission management, `cash.reconcile`, and existing grants.

Respect roles (`owner`, `gym_admin`, `gym_staff`, `trainer`, `member`, `guest`) and keep operational capabilities separate. UI hiding is not security.

## Commerce rules

Member Shop categories are Food & Drinks, Merch & Apparel, Supplements, and Services. Use one universal basket across categories and fulfilment types; persist only scoped product/quantity intent, never trusted prices or totals. Barcode matching is exact after canonical normalisation; manual and keyboard-scanner paths must work, and camera scanning is offered only after genuine feature detection with a truthful fallback. Keep local stock, allocated customer stock, inbound stock, supplier availability, services, and dropship fulfilment distinct.

Madhouse Balance is club stored value with an append-only ledger, no negative balance, and separate top-up/spend events. The only permitted split tender is Balance plus at most one external method. Hold Balance before an external attempt, capture it exactly once only after trusted provider success, and release it on failure/cancellation; never expose a member-callable fake-success path. Unconfigured card, BNPL, bank-transfer, Printify, supplier, access, push, health, or messaging providers remain unavailable/truthful.

Supplier cycles are supplier-specific and timezone-aware. Preserve provenance when consolidating paid member demand with location replenishment, account for inbound stock, and never confuse supplier availability with gym stock. Receiving must separate member allocation from free stock and remain auditable.

## UI quality and navigation

Use the existing R12 near-black/purple design language, shared components, accessible labels, 44px touch targets, responsive mobile/desktop layouts, and natural business wording. Do not expose raw UUIDs, RPC/schema/migration terminology, private supplier costs, or backend health noise to ordinary users. Keep primary Club navigation concise; group supplier operations under Shop and keep authorised navigation consistent.

## Validation and git workflow

Before work, inspect `git status`, relevant code, migrations, and package scripts; preserve unrelated changes. Add behaviour-focused regression tests. Run focused tests, then the actual full suite (`npm test`), production build (`npm run build`), lint (`npm run lint`), and `git diff --check`. Do not claim a check passed unless it actually did; report material warnings. Review the diff, commit with a clear conventional message, and push `origin/main` when requested. Do not claim deployment success without verification.

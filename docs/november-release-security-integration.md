# November release security integration — 23 October 2026

- Integration branch: `integration/november-release-security`.
- Approved release baseline: `000d475dc85f4f801211510e7e9199e66fd5c069`.
- Only cherry-picked source commit: `fd73884b9934078c59abfd677226f5194847737e`.
- Resulting security commit: `529c471` (clean automatic merge).

The release's Android npm commands, household billing workflow filters and
account-deletion/staged-induction database validation were preserved alongside
the security versions, install-script policy and lockfile/`.npmrc` CI triggers.
Application code, authentication, Club/Coach, native configuration and all
migrations remain byte-for-byte unchanged from the approved release baseline.
The authentication hotfix was already present and was not reapplied.

## Broken database command

Removed `db:init:hosted-stripe-test` from `package.json`: its target,
`scripts/initialize-hosted-stripe-test-db.sh`, is absent from the release and
has no tracked history in the available repository refs. The only reference
found was the dangling package command itself.

No replacement database initialization procedure was invented. The existing
`scripts/stripe-test-local.sh` and `docs/r12-stripe-local-test-runbook.md` remain
unchanged. They describe an explicitly local disposable Supabase/Stripe test
setup with prerequisites; they are not a hosted-database initialization alias.

## Scope and release limits

The previous `dependency-security-remediation.md` retains its historical
validation results from the older application baseline. This integration must
be assessed using the combined release validation below.

The documented development-only braces advisory remains an explicit release
exception, not a requirement for a zero-exit full audit. No new full audit was
required for this focused integration. Do not use `npm audit fix --force`.

No safe disposable PostgreSQL environment is available locally: `psql` and
Docker are absent, and `R12_TEST_DATABASE_URL` / `PGDATABASE` are not configured.
No database harness, migrations, provider tests or production writes were run.
Before deployment, run the existing isolated PostgreSQL CI and combined staging
checks, inspect deployed migration history/checksums through the authorised
release process, and verify actual production dependency/native artifacts.

No push, merge into the release branch, deployment or live configuration change
is part of this integration. The next release action is review of this branch,
then isolated database/staging validation before separately authorised promotion.

## Combined release validation

Validated locally on Intel macOS with Node 24.22.1 and npm 11.19.1:

| Check | Result |
| --- | --- |
| `npm ci --no-audit` | Passed; 359 packages; reviewed strict install-script policy enforced |
| `npm audit --omit=dev --json --ignore-scripts` | Passed; zero production advisories |
| `npm run lint` | Passed; no warnings printed |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Passed |
| `npm test` | Passed; 1,314 tests, 1,313 passed, zero failed, one skipped |
| `npm run build` | Passed; Next 16.4.2/Turbopack production compilation, type validation and page generation |
| `npm run android:validate` | Passed for all four release descriptors and manifest/asset-link routing contracts |
| `npm approve-scripts --allow-scripts-pending` | No unreviewed install scripts |
| `git diff --check` | Passed |

The skipped Active Sports database integration test requires a disposable local
PostgreSQL database. Android validation did not build/sign an AAB or verify live
fingerprints. Local tests do not establish live auth, check-in hardware, provider
webhook, WHOOP or deployed-image behavior. Clean install retains the existing
warning that ESLint 9.39.1 is unsupported; no unrelated tooling upgrade was made.

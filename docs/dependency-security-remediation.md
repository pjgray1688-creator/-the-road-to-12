# Dependency security remediation — 22 October 2026

Target launch: 1 November 2026. Branch: `chore/dependency-security-remediation`.
The starting checkout was clean. No application, schema, provider configuration,
production data, or deployment changes were made.

## Changed files

- `package.json`: pin Next and its ESLint configuration to 16.4.2, tsx to
  4.23.15, and record the version-specific installation-script decisions below.
- `package-lock.json`: resolve the requested compatible security updates and
  their platform binaries. No global overrides or unrelated major updates.
- `.npmrc`: enable `strict-allow-scripts=true` so unreviewed lifecycle scripts
  fail installation on supporting npm versions.
- `.github/workflows/validate-migrations-postgres.yml`: add `package-lock.json`
  and `.npmrc` to both push and pull-request path filters. Existing application
  checks and isolated database workflow remain unchanged.
- This report: installation-script review, advisory exception, validation and
  release limitations.

## Verified installed dependency versions

| Dependency | Before | After |
| --- | --- | --- |
| next / eslint-config-next | 16.3.3 | 16.4.2 |
| sharp | 0.35.4 | 0.35.5 |
| @img/sharp-libvips platform bundles | 1.3.3 | 1.3.4 |
| source-map-js (next → postcss) | 1.2.1 | 1.2.2 |
| brace-expansion (eslint → minimatch) | 1.1.18 | 1.1.21 |
| brace-expansion (typescript-estree → minimatch) | 5.0.9 | 5.0.12 |
| tsx | 4.21.0 | 4.23.15 |
| esbuild (tsx) | 0.27.7 | 0.28.2 |

React/React DOM 19.2.8, Supabase packages, ESLint 9.39.1 and TypeScript 5.9.3
remain unchanged. Sharp reports librsvg 2.63.2. Native packages for other
platforms are present in the lockfile; only Intel macOS was exercised locally.

## Installation-script review

The initial install used `npm ci --ignore-scripts --no-audit` to inspect package
contents without executing lifecycle hooks. The final clean install used
`npm ci --no-audit`, with strict checking and this explicit policy:

| Package | Decision | Review and rationale |
| --- | --- | --- |
| esbuild@0.28.2 | Allow this exact version | `postinstall: node install.js` prepares and validates the platform binary used by tsx. Inspected platform selection, binary execution, writes and fallback downloads. Direct fallback downloads check the binary hash before writing. Needed for supported native-tool setup; no approval of future versions. |
| unrs-resolver@1.12.2 | Allow this exact version | `postinstall: node postinstall.js` calls `napi-postinstall@0.3.4` to prepare native resolver bindings for the ESLint TypeScript import resolver. Inspected the wrapper and helper's child-process, registry/download and filesystem paths. Fallbacks can invoke a package manager or download a binding. This is an execution permission, not a claim that all fallback paths are sandboxed. |
| fsevents@2.3.3 | Deny this exact version | Lock metadata flags install activity; installed manifest declares no explicit install/postinstall hook and ships a prebuilt `fsevents.node`. Optional macOS development watcher. No native rebuild was authorised; clean install and tests succeed with denial. Interactive file watching was not exercised. |

No wildcard, package-name-only approval, `--all`, or
`--dangerously-allow-all-scripts` was used. The read-only command
`npm approve-scripts --allow-scripts-pending` reports no unreviewed packages.
Approval must be reviewed again if either permitted package version changes.
These scripts run with installer privileges; fallback network activity remains
a supply-chain consideration. Preserve platform optional dependencies in CI.

Validation used Node 24.22.1 and npm 11.19.1. Older npm versions may not enforce
this policy: release CI must confirm its npm supports `allowScripts` and
`strict-allow-scripts`. This change does not replace the workflow's toolchain.

## Remaining advisory and temporary exception

- Advisory: [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Package: braces 3.0.3, recursive-pattern stack-exhaustion denial of service.
- Exact observed path: eslint-config-next 16.4.2 → @next/eslint-plugin-next
  16.4.2 → fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3.
- npm reports five high package entries for this one propagated advisory:
  braces, micromatch, fast-glob, @next/eslint-plugin-next, eslint-config-next.
- No patched braces release was available in the audit. The upstream maintainer
  disputes the advisory; that does not make the reported finding disappear.
- Scope of the documented temporary exception: this advisory and this
  development-only lint chain, consuming repository-controlled glob patterns.
  No application import or HTTP-input path was identified. Untrusted repository
  changes can still affect developer/CI tooling. Do not lint untrusted changes
  with production credentials available.
- Tracking owner: R12 repository maintainers. Review before launch and expire
  this proposed exception on **8 November 2026**; renew explicitly or replace
  the affected tooling if still necessary. Recording it here is not release
  owner approval and does not suppress audit results.
- Do not downgrade eslint-config-next to npm's suggested 14.2.35. Do not use
  `npm audit fix --force` or replace braces with an API-incompatible package.

Full audit: **5 high, 0 critical**, exit 1. Production-only audit: **0 findings**,
exit 0. These results are registry snapshots, not proof against undisclosed
vulnerabilities or a statement about the currently deployed artifact.

## Validation results

| Check | Result |
| --- | --- |
| npm ci --ignore-scripts --no-audit | Passed; 359 packages |
| npm ci --no-audit with final policy | Passed; 359 packages |
| npm audit --json --ignore-scripts | Exit 1; only the five development braces-chain entries above |
| npm audit --omit=dev --json --ignore-scripts | Passed; zero findings |
| npm ls for remediated dependencies | Passed; installed versions match the table |
| npm run lint | Exit 0; zero errors, three warnings |
| ./node_modules/.bin/tsc --noEmit --incremental false | Passed; repository has no typecheck npm script |
| Focused existing regressions, 11 files | 156 passed, no failures or skips |
| Focused Club class/Server Action contract checks | 8 passed, no failures or skips |
| npm test | 1,117 tests: 1,116 passed, zero failures, one skipped |
| npm run build | Passed with Next 16.4.2/Turbopack; 111 static pages generated |
| Native smoke checks | Sharp PNG encode/decode/resize, esbuild TypeScript transform and UnRS file resolution passed |
| git diff --check | Passed |

The first full `npm test` attempt was blocked by sandbox EPERM when tsx created
its local IPC pipe. Rerunning the actual npm test command outside the sandbox
passed with the counts above. No test implementation was changed to obtain a pass.

Lint warnings: internal `window.location.assign()` in
`components/coach-account-actions.tsx`; plain `<img>` in
`components/exercise-guide-sheet.tsx` and `components/training-app.tsx`.
Clean install warns that the unchanged ESLint 9.39.1 is unsupported. The build
also identifies the existing experimental Server Actions configuration.

Focused command:

```sh
node --import tsx --test tests/auth-return.test.ts tests/coach-standalone-auth.test.ts tests/capability-layer.test.ts tests/club-member-access-safety.test.ts tests/club-attendance-station.test.ts tests/club-shared-station.test.ts tests/club-product-media.test.ts tests/workout-persistence.test.ts tests/live-workout-reliability.test.ts tests/health-data.test.ts tests/architecture.test.ts
node --import tsx --test tests/club-classes-ui.test.ts
```

Coverage includes auth return/deep-link behavior; ownership/capability and
organisation-scope contracts; Club attendance/station checks; class Server Action
source contracts; product image resolver/fallback contracts; workout persistence
and canonical-state logic; WHOOP normalization, token encryption and integration
source contracts. Some tests inspect source/SQL rather than exercising a running
server or database. Native image smoke uses generated pixels in memory, not a
provider response, production upload, or malicious payload.

## Release risks and next actions

The skipped test is Active Sports database permissions/reconciliation/price
history/checkout/local POS: it requires a disposable local PostgreSQL database
with migrations. No SQL or database integration checks were run locally. The
GitHub isolated PostgreSQL workflow was not executed here; its trigger correction
was reviewed in the diff.

No live authentication/session exchange, browser Server Action request,
cross-tenant database attack, physical Club check-in, deployed image optimizer,
production workout write, or WHOOP OAuth/API call was exercised. Interactive
watching with denied fsevents scripts also remains unverified. Confirm these in
an isolated preview/staging environment, then verify the actual release artifact
and Linux native image dependencies before launch. Do not infer deployment
success from the local build.

No significant upgrade incompatibility was observed. Following scope review,
the user authorised one local commit despite the documented development-only
braces advisory and skipped database test. The production audit was rechecked
and remains clean; all validation results above are preserved. Release owner
acceptance of the scoped braces exception and remaining integration validation
are outstanding. Nothing was merged, pushed or deployed.

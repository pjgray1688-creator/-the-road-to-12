# Club privacy — production-based integration readiness

24 October 2026. Integration branch: `integration/r12-club-privacy-release`, worktree `/private/tmp/r12-club-privacy-release`.

## Source and scope

Production was resolved through Vercel from `app.r12.live`: READY deployment `dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf`, commit `ff8ec5f02727419991e3a4b8340ecb5432c48f64`. It has not advanced since the approved R12 release. That exact commit is the parent baseline for this integration, not `main`, the native preparation branch or an older security branch.

Inspected both completed worktrees:
- `prep/r12-club-apple-submission`: `fcc297ef6d95636315c49653069de724f188a20b`; has a subsequent local Xcode project modification. This was preserved and not copied or staged.
- `fix/r12-club-public-privacy`: clean `344b29efcf41f908086629de0c7203711d487f8e`.

Applied only the reviewed privacy commit's patch onto the new production-based worktree. No branch merge was performed. The one dependency is documentation: `AppPrivacyCorrections.md` was created in native preparation and modified in the privacy commit, but does not exist in production. Its full reviewed source version was carried as a new document. All integrated privacy-source files match their source Git blobs; the old operational privacy route is removed as in that commit. The original branches remain unchanged.

**Excluded:** Club signing team/project changes, launch correction, native required-reason manifest, native release tests and the signed/unsigned archive artifacts from `fcc297e`. Statements in the carried disclosure matrix about the prepared native manifest refer to that separate preparation branch, not this web-only integration.

No iOS source/configuration, binary, Apple record, API route, database schema, migration, payment logic, provider code, credentials, environment variable, dependency or cron configuration was changed. Main R12 `/privacy`, `/support`, the shared legacy policy component, account/auth code and other applications are byte-identical to production. The only middleware change is the Club public-policy exception described below; the matcher still excludes non-Club paths.

## Public access and integrity

The URL stays `/club/privacy`; its page moves to the `(public-club)` route group so it no longer inherits operational Club layout/account queries. The policy is static and has no Supabase/client-data call or form submission.

The proxy/helper exception requires exact `/club/privacy` and method GET/HEAD. It allows the notice for anonymous users, reviewers and users carrying a locked-station cookie. It does not grant an operational capability, bypass a Club API, alter authentication, or permit a reviewer write. Other operational routes keep their station/session and reviewer-demo behaviour. Nested/similar/API paths do not qualify. Source tests assert these boundaries.

The notice uses owner-approved monitored `peter@r12.live`, actual processing and relevant provider descriptions, request-only deletion instructions, existing response commitment and criteria-based retention exceptions. It does not certify controller/processor contracts, health-data legal grounds, international safeguards, automatic erasure or fixed retention periods.

## Future deployment procedure — NOT executed or authorised by this report

No push, merge, deployment or environment change was made. A future release requires separate owner approval of the exact final integration SHA and customer wording. Use the SHA reported in the final handoff and verify `git rev-parse integration/r12-club-privacy-release` matches it before starting.

### Preflight and rollback capture

1. Re-resolve `app.r12.live` using `vercel.get_deployment` with Git information. Expected baseline today is `ff8ec5f02727419991e3a4b8340ecb5432c48f64`. If production moved, stop and compare/integrate its newer changes in a fresh isolated branch before deploying. Do not replace newer work.
2. Confirm clean worktree, approved HEAD, tests/build results and exact `ff8ec5f..HEAD` diff. Verify native/API/database/provider/dependency paths remain unchanged. Do not include the native preparation commit or modify the prepared Club archive.
3. Capture the then-current READY production deployment ID, commit and aliases as rollback evidence. Current known-good target is **`dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf`**, URL `https://the-road-to-12-hiavr9bmj-peter-gray.vercel.app`, commit `ff8ec5f`. Keep it; do not delete it. The earlier `c7f94ba` deployment is not the correct rollback target for this release because it would remove the already-approved R12 web release.
4. Read production environment metadata without printing values. Confirm existing Supabase/Stripe/WHOOP/email/webhook/station configuration is present; take a private comparison snapshot. Do not edit, copy or expose values. No database migration or provider change is required by this patch.

### Approved branch push and protected preview

Only after push/preview approval, push this branch without force:

```sh
git -C /private/tmp/r12-club-privacy-release push origin refs/heads/integration/r12-club-privacy-release:refs/heads/integration/r12-club-privacy-release
```

This intentionally allows Vercel's existing Git integration to create a Preview. Confirm project `prj_cOkcINMIEn7vv0MOpOvhYffWj4uP`, team `team_6WTX0aq6dKQHqDT97nitjoyU` / `peter-gray`, exact approved SHA, Preview target, READY state and protection. Do not change environment settings or disable protection. Inspect public pages through authorised access only; if Vercel authentication blocks access, report that limitation instead of making a bypass link. A READY state alone does not prove page correctness.

### Separately approved production release

Create a **new production-targeted build** from the pinned approved commit in the existing project. Do not promote/alias the protected Preview or build with Preview configuration. Use the connected `vercel.create_deployment` operation with:

```json
{
  "teamId": "team_6WTX0aq6dKQHqDT97nitjoyU",
  "requestBody": {
    "name": "the-road-to-12",
    "project": "prj_cOkcINMIEn7vv0MOpOvhYffWj4uP",
    "target": "production",
    "gitSource": {
      "type": "github",
      "repoId": "1351450196",
      "ref": "integration/r12-club-privacy-release",
      "sha": "REPLACE_WITH_EXACT_OWNER_APPROVED_INTEGRATION_SHA"
    }
  }
}
```

No `deploymentId` from Preview, custom environment, `files`, environment overrides or project-settings overrides. Existing production configuration is used. Inspect until READY or failure. Verify `target=production`, exact Git SHA, no alias error, and that resolving `app.r12.live` returns this new deployment. Compare production environment metadata to the preflight snapshot without disclosing values.

### Post-deployment read-only checks

- Clean anonymous GET and HEAD `/club/privacy`: HTTP 200 at that path, no sign-in/demo/lock redirect. Check title/canonical URL, `peter@r12.live` text and mailto link, Support/Terms/R12 privacy/deletion links, request-only deletion and one-month response wording. Confirm no internal repository/placeholder/no-deletion-route statements.
- Browser check at mobile and desktop widths: readable layout, no horizontal overflow or page errors. If an existing authorised reviewer or station session is available, load **the policy only** to verify it remains public. Do not forge authentication cookies against production; synthetic cookie cases are local/unit tests only.
- Read-only signed-out route checks: `/privacy`, `/support`, `/account`, `/account/delete`, `/training`, `/member-hub`, `/club`, `/club/checks`, `/coach`, `/glow-zone`. Expected sign-in redirects are not failures. Compare R12 public notice/support content and normal Club sign-in gating with baseline.
- Do not submit a deletion/reset/registration form, run payments, invoke live webhooks/workers, change records, or test hardware. Do not use authenticated Home casually: cached workouts may import. Source regression tests cover station locks and reviewer/API denial without live writes.
- Review deployment/runtime errors where authorised, avoiding secret/personal-data output. Record limitations; unauthenticated checks are not end-to-end reviewer or provider validation.

### Rollback trigger and exact action

If the new deployment fails essential public-policy/routing checks, introduces server errors or unexpectedly weakens access protections, restore the captured previous **production** deployment. For today's unchanged baseline, use `vercel.request_rollback`:

```json
{
  "teamId": "team_6WTX0aq6dKQHqDT97nitjoyU",
  "projectId": "prj_cOkcINMIEn7vv0MOpOvhYffWj4uP",
  "deploymentId": "dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf",
  "description": "Restore approved R12 baseline after Club privacy release smoke-test failure"
}
```

Use the freshly captured rollback target if it differs after a separately approved newer baseline. Poll the restored mapping and recheck public/auth routes. Record the failed deployment and errors. No schema/data/provider rollback is needed for this code-only patch. Rollback can affect future automatic alias assignment; review the project's release state before a later deployment rather than assuming a push will resume normal promotion. Do not roll back the database or Apple build.

## Privacy decisions remain separate from technical compatibility

The internal full matrix is `ios/R12Club/AppPrivacyCorrections.md`. Owner actions: confirm diagnostic/crash/performance collection and linkage, exact retained payment fields, staff avatars/support attachments, partner tracking, actual service/controller arrangements, health-data legal grounds, transfers/safeguards, retention and operational deletion fulfilment. Health and Customer Support additions and applicable personalization purposes remain proposed Club App Privacy corrections; no Apple record was edited. Publishing accurate wording is not proof of legal compliance or readiness of the signed Club binary.

The Club provisioning/profile, signed archive, reviewer login, iPhone/iPad screenshots and Apple submission gates remain on the native preparation track. They are not changed or solved by this web integration.

## Integrated validation completed

- Focused privacy/deletion/reviewer tests: **20 passed, 0 failed**.
- Actual `npm test`: **1,339 passed, 1 skipped, 0 failed** (1,340 total). The skipped fixture needs a disposable migrated PostgreSQL instance; no production database used. Counts exclude the two native-preparation tests, deliberately not included here.
- `npm run build`: **passed**, including TypeScript/static generation; `/club/privacy` is static.
- `npm run lint`: **passed**, 0 errors, same 3 existing warnings: coach-account-actions internal navigation, exercise-guide-sheet/training-app image usage.
- Local production server and real browser: anonymous and local synthetic reviewer-plus-station requests returned GET/HEAD **200** at `/club/privacy`, approved contact present, no login/demo/lock redirect, no stale internal text, no page errors. Mobile viewport/document both 390px; desktop capture completed.
- Live local middleware checks without following redirects: station-cookie `/club/checks` **307**; reviewer `/api/club/access/decision` GET **403**. No provider request or production session used.
- Source tests also assert reviewer POST denial and the exact path/method boundary.
- File integrity checks: integrated privacy files equal the original reviewed blobs; native iOS trees are identical to production; API/database/provider/config/dependency paths and R12 notices/support are unchanged.
- `git diff --check`: **passed**. No native rebuild, archive modification, signing/profile change, Apple upload, push, merge or deployment.

Logs/captures: `/private/tmp/r12-club-integration-focused.log`, `r12-club-integration-tests.log`, `r12-club-integration-build.log`, `r12-club-integration-lint.log`, `r12-club-integration-browser.log`, `r12-club-integration-mobile.png`, `r12-club-integration-desktop.png`.

Technical result: **ready to request approval for a protected Preview of the exact integrated commit**. Production release remains separately authorised and requires the preflight, owner decisions and post-deployment checks above. The live Club policy is not updated by this preparation.

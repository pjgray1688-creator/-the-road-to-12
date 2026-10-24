# R12 Club — first Apple submission readiness

24 October 2026. Branch `prep/r12-club-apple-submission`, isolated worktree `/private/tmp/r12-club-apple-submission`, based on approved deployed `ff8ec5f02727419991e3a4b8340ecb5432c48f64`. No production deployment, environment/provider/database change, upload or submission occurred. Main R12, Coach, Glow and shared native source files were not changed. Existing Xcode changes in other worktrees were preserved.

## Decision

**Club compiles and an unsigned Release device archive has been prepared. It is not yet ready to upload/submit.** Blockers are a missing Club provisioning profile, the stale public Club privacy policy, final diagnostic/provider privacy answers, and a fresh authenticated reviewer walkthrough that was not possible with available access. Owner-reported Google Play reviewer success is retained as prior evidence, not described as a new test.

## Isolated changes

1. `ios/R12Club/R12Club.xcodeproj/project.pbxproj`: set established R12 Digital Ltd team `79ZP9U47SK` for Club Debug/Release only; retain automatic signing, bundle, version, device family and all native navigation. Add Club's privacy manifest to resources.
2. `ios/R12Club/App/PrivacyInfo.xcprivacy`: required-reason declaration for `NSPrivacyAccessedAPICategorySystemBootTime`, reason `35F9.1`. Shared code uses `ProcessInfo.systemUptime` to measure elapsed web navigation time and writes an OS debug log. The reason was checked against Apple's current documentation. No “Data Not Collected” or provider/tracking assurance was inserted.
3. `ios/R12Club/App/LaunchScreen.storyboard`: replace malformed hexadecimal colour strings with numeric components for the existing near-black colour. Layout, labels and Club identity retained.
4. `tests/club-ios-release.test.ts`: regression coverage for manifest inclusion, reason, Club signing/version and valid launch colour components.
5. This report and `AppPrivacyCorrections.md`: owner handoff and full declaration matrix. No website copy or shared app behaviour changed.

## Resolved project settings

| Item | Verified result |
| --- | --- |
| Project/scheme | `ios/R12Club/R12Club.xcodeproj`, shared scheme `R12Club` |
| Bundle / display name | `live.r12.club` / `R12 Club` |
| Version/build | `1.0.0` / `1`, verified in built device archive |
| Release archive action | Release, `SKIP_INSTALL=NO`, whole-module optimized Swift, dSYM |
| Signing | Automatic, R12 Digital Ltd team `79ZP9U47SK`; local matching Club provisioning profile missing |
| Xcode | 26.1.1 (17B100), device SDK iOS 26.1; simulator Release and device compilation succeeded |
| Deployment target | iOS 17.0 |
| Device family | iPhone **and iPad** (`1,2`), preserved; prepare both required screenshot sets or explicitly review device-family scope before building |
| Icon | Club-specific 1024×1024 App Store icon, no alpha, included asset catalog |
| Launch | Existing dark Club title/subtitle storyboard; numeric colour corrected |
| Entitlements | No custom capability entitlement file; no HealthKit, push, Sign in with Apple or associated-domain capability used by this shell. Custom `r12-club` URL scheme is in Info.plist |
| Native navigation | Reception, Daily checks, Inductions, Overview, More; per-tab NavigationStack/WKWebView; persistent default website data store; back, reload, pull-to-refresh, privacy shortcut and error recovery |
| Production origin | HTTPS `app.r12.live`; privacy shortcut `/club/privacy`; cleartext loads disabled; external HTTPS in Safari view |
| Authentication | Supabase email/password in hosted UI; normal Club sign-in preserves `next`; no main R12 member-shell marker injected for Club |
| Native/privacy limitation | `scope` controls deep links, not every same-host web navigation. Shared Account exposes personal R12 routes. See full matrix; do not assert a strict staff-only data boundary |

No Apple signing/profile registration or `-allowProvisioningUpdates` was executed. The existing main R12 project provided reliable team evidence; no team was invented. Xcode signing can succeed only once the owner supplies/creates the correct profile with authorised account access.

## Validation and build evidence

- Initial Release simulator build: **passed** with existing Club sources before the isolated resource/signing fixes.
- Final Release **device unsigned archive: passed**, compiling final sources/resources and verifying packaged Info.plist + privacy manifest.
- Archive: `/private/tmp/R12Club-1.0.0-1-unsigned.xcarchive`.
- **This unsigned archive is NOT upload-ready and must not be distributed.**
- Signed local archive attempt: **failed**, no iOS App Development provisioning profile for `live.r12.club`; no upload attempted. Automatic project signing remains enabled, but CLI cannot generate a missing profile without provisioning permission.
- Final packaged bundle: `live.r12.club`, display `R12 Club`, version `1.0.0`, build `1`, minimum OS `17.0`, iPhone/iPad; `PrivacyInfo.xcprivacy` contains `35F9.1`.
- iOS source configuration validator: **passed**.
- Focused new release/reviewer tests: **13 passed**, 0 failed. Additional existing focused privacy/iOS checks ran successfully before the final isolated resource changes.
- Actual `npm test`: **1,337 passed, 1 skipped, 0 failed**. Skip requires a disposable migrated PostgreSQL instance; no production database was tested.
- `npm run build`: **passed**, including TypeScript/static generation.
- `npm run lint`: **passed**, 3 pre-existing warnings (coach-account-actions internal navigation, exercise-guide-sheet/training-app img usage).
- Plist/project lint and `git diff --check`: **passed**.
- Existing launch storyboard Dynamic Type warnings and AppIntents metadata-extraction warning remain; neither prevented compilation/archive. No AppIntents dependency is present.
- Xcode's first sandboxed build-settings query could not write default DerivedData. Re-run with authorised execution and isolated `/private/tmp` DerivedData succeeded; resolved settings above come from that successful query.
- No fresh authenticated device/simulator reviewer walkthrough or signed distribution validation was performed. These results do not certify production migration state, all provider settings or App Review acceptance.

Build logs are `/private/tmp/r12-club-simulator-build.log`, `r12-club-unsigned-archive.log`, `r12-club-signed-archive.log`, `r12-club-release-settings.log`, `r12-club-full-tests.log`, `r12-club-web-build.log`, `r12-club-lint.log`.

## Privacy release blockers

`https://app.r12.live/club/privacy` returned HTTP 200 but still states no verified public privacy email and no in-app/web deletion request route. It includes internal repository/audit/pending-role text. This policy was not fixed by the R12-only notice and is not release-ready for Club. `https://app.r12.live/support` returned HTTP 200 with the owner-approved `peter@r12.live` contact.

A separately authorised Club policy correction must use verified operator/controller facts and the existing `/account/delete` request process: password reauthentication, manual review, one-calendar-month response commitment, retention exceptions and no automatic subscription cancellation. Confirm responsible controller(s), health-data legal grounds where personal R12 routes are reachable, providers/transfers, retention and an operator who can fulfil actual erasure/anonymisation. No customer legal promises were invented or published by this task.

Full category corrections are in `AppPrivacyCorrections.md`. Key changes: keep the substantiated contact/identity/content/purchase/financial categories; Health is additionally relevant because of reachable personal training/WHOOP flows; Product Personalization is a **purpose**, not a category; audit-based Product Interaction is App Functionality, not automatically Analytics; Crash/Performance selections are unsubstantiated without provider collection confirmation. Add Customer Support for identified requests/correspondence, subject to Apple's actual disclosure rules. Owner must resolve diagnostics, payment fields and personal-photo/provider details before finalising.

## Reviewer access and coverage

Existing identity: `staff@r12.live`. Do not create a duplicate, reset its password, or grant real administrative rights to demonstrate fixtures.

Code requires the exact email **and confirmed email** after server-side `auth.getUser`. The proxy rewrites reviewer Club GET/HEAD requests to synthetic pages, blocks Club APIs and non-read requests, and grants no real Club role. The fixture `gym_staff` value is UI data only. Production contains these same source rules; owner reports Google Play testing succeeded. This task has no authorised reviewer password/session or Supabase admin connection, so actual Auth state and current login are not newly verified.

| Journey | Source-backed demonstration | Current verification |
| --- | --- | --- |
| Dashboard/Overview | Synthetic operational overview and directory | Routing/fixtures/tests verified; fresh signed-in view unverified |
| Reception | Synthetic recent arrivals; no hardware | Same |
| Daily checks | Production checklist component with `canSubmit=false`, `canReview=false`, `readOnly` | Same; no real checklist was submitted |
| Inductions | Static example topics/status; cannot complete real induction | Same |
| Membership management | Search/filter synthetic directory and member details; no real changes | Same |
| Classes/bookings | Synthetic timetable/register/report, read-only; no live booking/cash | Same |
| Shop | Synthetic catalogue/local demonstration basket, no real checkout or financial admin | Same |

Unauthenticated live checks reached sign-in for Club, checks, inductions, shop and reviewer routes; classes rendered its public/auth-gated presentation. No forms submitted. These are route-gating checks, not evidence of successful reviewer login.

Caveats: fixture banners still say “Google Play review”; include an explanation in Apple review notes. The native More destination `/club/more` currently falls into the review fixture's restricted-operation screen; Overview links provide the supported examples. Some timetable dates are fixed in October 2026 and need checking at the review date. These findings were not concealed or changed on production. Existing generic walkthrough instructions that promise saving checks/inductions do not apply to the read-only reviewer.

### Paste-ready reviewer notes (after a successful final login check)

> R12 Club is a gym staff operations app, separate from the R12 personal training app. Sign in with staff@r12.live and the password supplied separately in App Store Connect's review credentials.
>
> Use the native Overview tab to explore the synthetic member directory, class timetable/register and shop examples. Reception shows sample arrivals; Daily checks and Inductions show read-only operational examples. Some demonstration labels refer to Google Play review; this is the same established review mode. The More tab includes restricted areas; use Overview for the supported demonstration routes.
>
> All people and operational examples in this review workspace are synthetic. Saving checks/inductions, changing memberships, payments/refunds, permission administration and physical-access operations are restricted. No real purchase, door operation or sunbed session is required. Actual gym staff access requires authorisation by a participating organisation.

Do not place the password in source, screenshots, notes files or Git.

## Exact owner steps to prepare/upload Club build 1

1. Resolve/approve the Club policy and declaration corrections separately; verify the final public `/club/privacy` page. Use `https://app.r12.live/support` as Support URL if approved for the Club listing. Do not infer main R12 approval covers Club's old notice.
2. Open `/private/tmp/r12-club-apple-submission/ios/R12Club/R12Club.xcodeproj`. Select **R12Club** only. Confirm Signing & Capabilities uses **R12 Digital Ltd**, team **79ZP9U47SK**, Automatic Signing and bundle **live.r12.club**. Sign into the authorised Apple Developer account if necessary and allow Xcode to resolve the Club provisioning profile. Do not change the main R12 project or its build number.
3. Run Club on a simulator/device. Confirm fresh sign-in with the existing reviewer identity; check Reception, Daily checks, Inductions, Overview, synthetic directory/classes/shop and privacy/support/deletion presentation without real submissions. Confirm no personal member data or finance/hardware authority is exposed. Check iPad as well as iPhone because the target supports both.
4. Verify Club's App Store Connect record uses bundle **live.r12.club**, version **1.0.0**, and has no already-uploaded conflicting build **1**. This task did not access Apple's listing. User-reported listing/pricing/UK availability/age rating/description/privacy entries were not changed.
5. Select **Any iOS Device (arm64)** → Product → Archive (Release). Create a **new signed archive**; do not upload the unsigned artifact from this task. Confirm app/version/build/team/bundle in Organizer, then **Validate App**. Review the generated privacy report/required-reason declaration and address validation findings.
6. Owner only: Organizer → Distribute App → App Store Connect → Upload, selecting the Club archive. No automatic upload was authorised or performed here. Wait for processing and resolve encryption/export questions based on the actual OS-only HTTPS implementation; no unreviewed `ITSAppUsesNonExemptEncryption` assertion was added.
7. Add/verify iPhone and iPad screenshots for Club, attach processed build 1, review privacy/support URLs and category corrections, provide working credentials in the dedicated fields and the accurate read-only notes above. Confirm all remaining compliance/content rights/agreement prompts. Submit only after the owner completes these checks.

The currently uploaded main R12 app is untouched. A successful local compile/unsigned archive is not proof of signed distribution readiness, reviewer login or Apple acceptance.

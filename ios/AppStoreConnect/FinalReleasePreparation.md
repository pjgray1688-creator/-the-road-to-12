# R12 final header and release integration — 23 October 2026

## Completed source change

Removed only the main R12 shell's centred purple `Text("R12")` principal toolbar item. Added native UI assertions that the navigation bar has no R12 title and that Page options remains available. The dark header, conditional back button, swipe-back support, Reload/Privacy menu and native tab bar are unchanged. No other app's header or navigation was changed.

Header commit: `b7c66cb` on `fix/r12-ios-final-release-prep`, based directly on verified `83a3071`. Files modified by that source commit:

- `ios/Shared/RouteWebScreen.swift`
- `ios/R12/Tests/R12NavigationUITests.swift`

The prior report and all 30 files in `83a3071` were reviewed. Its native launch assets, Home-first four destinations, persistent web view, scoped injected CSS, safe-area handling, password controls, auth recovery and Home retry remain present. The original preparation commit `84674bf` has the same iOS tree as integration base `95abe94`; none of its preparation was lost. The owner's new simulator confirmation supersedes the earlier report's uncertainty about basic loading and navigation appearance; submission-specific checks below still remain.

## Deployment evidence and current Git state

Read-only Vercel inspection identified project `the-road-to-12` (`prj_cOkcINMIEn7vv0MOpOvhYffWj4uP`) in team `peter-gray`. At inspection, `app.r12.live` pointed to READY production deployment `dpl_AghVn8G4cziSGd6gabWFVn62CvjV`, from commit `c7f94ba1e256df804ddcec0e099dd9fefaab048a`, branch `fix/r12-club-store-mobile-polish-2026-10-23`. The deployment source is `redeploy`.

This confirms the **currently deployed source branch**, not a project's automatic Git production-branch setting. The connector's project response did not expose that setting; the custom domain has `gitBranch: null`, and repository `vercel.json` only configures crons. Do not infer automatic deployment from `origin/HEAD -> main`. Confirm the automatic branch setting in Vercel before any approved future push. No Vercel setting was changed.

Fresh `git fetch origin` confirmed:

| Checkout/ref | State |
| --- | --- |
| Original `/Users/r12/-the-road-to-12` | `integration/november-release-security` at `95abe94`; original modified Xcode project and untracked workspace preserved |
| Local/remote `main` | `31eb5e0`; not the currently deployed source |
| Header worktree `/private/tmp/r12-ios-first-simulator` | `fix/r12-ios-final-release-prep`, source commit `b7c66cb` |
| Current production | `c7f94ba`, includes `95abe94` and the dependency/security fixes |
| New candidate `/private/tmp/r12-ios-release-candidate` | `integration/r12-ios-release-candidate`; source tip `113dabe`, production base plus exactly the two approved source commits |

Neither production nor `main` contains `83a3071` or its shared-web changes. Production has five later Club commits after `95abe94`: `9990bdd`, `93bd74d`, `2c19509`, `bf7a71a`, `c7f94ba`. All remain in the candidate's ancestry.

## Every shared web file requiring delivery

These 17 files are from `83a3071`; the header-only commit adds no web changes:

| Files | Delivered behavior |
| --- | --- |
| `app/account/page.tsx` | Shared password control; main iOS sign-in Home destination; stale-refresh protection and deferred auth callback; authorised Coach workspace access |
| `app/account/reset/page.tsx` | New/confirm password visibility controls |
| `app/globals.css` | Native-marker-scoped member navigation/padding rules; shared password-control styling |
| `app/layout.tsx` | Hydration-warning suppression for the native-injected HTML attribute |
| `app/training/page.tsx` | Explicit member content marker |
| `app/training/preview/preview-client.tsx` | Explicit member content marker |
| `app/tutorial/coach/page.tsx` | Explicit member content marker; existing tutorial behavior retained |
| `app/tutorial/member/page.tsx` | Explicit member content marker |
| `components/account-deletion-request.tsx` | Password confirmation visibility control |
| `components/app-nav.tsx` | Explicit member navigation marker; existing browser/PWA navigation retained |
| `components/club-pin-settings.tsx` | Shared password-confirmation visibility controls; PIN behavior retained |
| `components/home-shell.tsx` | Explicit content marker; authoritative-load failure/retry feedback |
| `components/ios-coach-access.tsx` | New authorised iOS Account workspace link |
| `components/password-input.tsx` | New accessible shared password visibility component |
| `components/privacy-deletion-queue.tsx` | Password confirmation visibility control |
| `components/training-app.tsx` | Explicit content markers |
| `components/ui.tsx` | Shared member content marker |

**Native versus web dependency:** the updated binary itself injects first-party identification and narrowly scoped CSS for both existing deployed navigation markup and the new markers. Hiding the duplicate bar and correcting the existing Home/Training content allowance already work with current production; no server permission or deployment flag is required. Production source lacks the new native-marker CSS and markers. Password toggles, revised web sign-in behavior, the iOS Coach link and Home error recovery still require delivering the shared web files above. Shipping the website does not ship the native header; rebuilding the binary does not ship the website.

## Prepared integration and minimal release plan

The isolated candidate is already concrete and reviewable:

1. Started at actual production `c7f94ba`, preserving the deployed Club work and security fixes.
2. Cherry-picked `83a3071` as **`79d4271`**. The only conflict was `app/globals.css`: both branches append styles. Resolution preserves production CSS verbatim and appends the eight original iOS/password CSS lines. No Club rule was replaced.
3. Cherry-picked header commit `b7c66cb` as **`113dabe`** without conflict. Native sources match the tested header branch byte-for-byte.
4. Ran integrated checks on this candidate; results below. This report is a separate documentation-only commit after those source commits.

For review, compare `c7f94ba..113dabe`. Do **not** cherry-pick the original commits again onto the candidate. If reconstructing elsewhere, use production `c7f94ba` as the base and pick `83a3071`, then `b7c66cb`, preserving both sides of the CSS append. Do not separately replay security commits already contained in production, or deploy the older `95abe94` worktree as a replacement for the current product.

Before release approval, re-fetch and re-resolve `app.r12.live`; if production moved, compare/rebase a new isolated candidate and repeat affected checks. Agree the maintained release branch and Vercel production source explicitly. Review the candidate diff, then obtain approval for integration/push/deployment as distinct external actions. After approved web delivery, verify fresh sign-in/out, password reset/visibility, expired-session recovery, Home retry, authorised Coach access, keyboard/final-page controls and the previously confirmed member/gym experiences in the actual binary. No database migration, environment-variable change, payment change or infrastructure change is required by these commits.

## Xcode and build verification

- Bundle `live.r12.training`; display name R12; iPhone family 1; iOS minimum 17.0.
- Version **1.0.0**, build **1**, unchanged. Check App Store Connect for an existing build 1 before a future upload; no increment was guessed.
- Automatic signing and team **79ZP9U47SK / R12 Digital Ltd** retained. No credential, profile or Apple identifier was modified or registered.
- Valid charcoal launch storyboard with existing purple R12 logo. App Store icon verified 1024×1024, no alpha.
- SwiftUI NavigationStack hosts one WKWebView and the existing Apple UITabBar through UIViewRepresentable; no tab styling/routing change in this task.
- R12 shared scheme exists; ArchiveAction uses **Release**. Generic `platform=iOS` Release build settings resolve correctly. This confirms scheme/destination selection, not signed device archive success.
- **Release simulator build passed** on Xcode 26.1.1. No archive or upload was performed.
- Native UI regression **passed** after this header change: no centred R12 header text, overflow control present, fresh-launch Home, four tabs, tab switching and back-to-Account selection.
- All four unsigned simulator app builds **passed** after the header change. Club, Coach and Glow Zone retain their previous native sources/configurations apart from the already-approved shared implementation.

## Validation

Header branch: iOS validator passed; full suite 1,317 passed / 1 skipped / 0 failed; production web build and type-check passed; lint passed with three pre-existing warnings. Release simulator build and native UI test passed.

Production-based candidate: iOS validator passed; **1,333 passed / 1 skipped / 0 failed**; `npm run build` passed with its TypeScript check; explicit `tsc --noEmit` passed; lint passed with the same three warnings (one internal-navigation warning, two img warnings). `git diff --check` passed. The skipped test requires a disposable migrated PostgreSQL database; no live database was used. The candidate's iOS files match the tested header branch, so the native build/test evidence applies to the exact integrated native sources.

The existing local Chromium fixture check passed browser navigation visibility, native-only hiding for both deployed and tagged markup, content padding, final long-page action visibility and input use. This supports ordinary-browser/PWA preservation; it is not a full PWA/device-keyboard or deployed fresh-auth test. No production account was deleted, purchase made or demo transaction created. Full device/provider regressions were not repeated by this task.

Existing Xcode diagnostics: AppIntents metadata extraction is skipped when no AppIntents framework is linked; other-app launch storyboard Dynamic Type warnings remain. No security/privacy protection was weakened.

## Remaining R12 submission requirements

| Requirement | Evidence and remaining action |
| --- | --- |
| App Store Connect app/version record | No App Store Connect session was available to inspect. Owner must confirm the R12 record, bundle, SKU, legal seller, agreements, availability and version/build uniqueness; absence of a record is **not** asserted. Repo SKU/copyright fields remain unset drafts. |
| Final iPhone screenshots | Capture final minimal-header build with approved demonstration data and no personal health/member details. R12 is iPhone-only; the older four-app screenshot plan's R12 iPad requirement is obsolete. Use current App Store Connect accepted sizes. |
| Privacy policy URL/content | `https://app.r12.live/privacy` returned HTTP 200 and displays the policy. Its live text still says R12 Training has no verified general privacy contact or published deletion route and leaves controller roles unresolved. Reconcile these statements with the implemented deletion flow using approved owner information before submission. Reachability alone does not make this final policy ready. |
| Support URL/contact | `apps.json` supportUrl is null; repository `lib/legal.ts` calls its address a placeholder. Supply and verify the monitored support URL/contact; do not invent one. |
| Reviewer credentials/data | Owner must supply a least-privilege independent R12 reviewer account and populated, non-personal demonstration journeys. Show the fitness experience without requiring a gym; gym features may use a separate approved linked demonstration account. No credentials/data were created in this task. |
| Account deletion fulfilment | In-app request UI exists. Verify the deployed authorised operator, retention-aware manual procedure, completion time and confirmation after identity removal. Do not confuse submitting a request with completed deletion. |
| Privacy declarations | Confirm App Privacy categories, linking/purposes and WHOOP/provider processing against the final deployed service. Native PrivacyInfo.xcprivacy is absent; audit actual required-reason API/native SDK usage before deciding declarations. No invented declarations were added. |
| Encryption/export compliance | HTTPS/WebKit uses OS encryption; owner must answer Apple's export-compliance questions for the final binary. ITSAppUsesNonExemptEncryption is not set. OS-only encryption can be exempt, but do not add an unreviewed declaration or assume no questions are required. |
| Age rating and listing accuracy | Complete the current questionnaire. R12 listing draft still points to Training and refers generally to membership-dependent features; update it to reflect Home-first independent R12 accounts and optional Club gym connection before submitting. |
| Digital purchases | Owner must classify any R12 digital subscriptions/features and remote coaching purchase paths under current Apple/storefront rules. Physical gym membership, goods and in-person classes remain existing external-payment flows. No Stripe or billing code changed. |
| WKWebView minimum functionality | 4.2 remains an App Review judgement, not a confirmed rejection or requirement to redesign now. Provide review notes showing working training, progress, wearable context, independent accounts and useful native navigation/device behavior. |
| Combined release validation | Deliver the approved web candidate and verify auth/password/deletion-request/keyboard journeys with the final binary. Then validate a locally signed device archive and final device/TestFlight behavior. |

Optional enhancements, **not blockers for preparing the R12 archive**: iPad support, new logos/branding, a new navigation design, Xcode Cloud, speculative native rewrites or future Club submission/distribution work. No such work was added.

Sources checked 23 October 2026: [Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance), [OS encryption and declarations](https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations).

## Reopen and archive decision

Use the integrated candidate project:

`/private/tmp/r12-ios-release-candidate/ios/R12/R12.xcodeproj`

Select **R12 → iPhone 17 Pro (iOS 26.1)** and Command-R; Command-U reruns the native regression. The header-only project also remains at `/private/tmp/r12-ios-first-simulator/ios/R12/R12.xcodeproj`.

**Yes: after approval/integration and combined web verification, proceed to a local signed Release archive validation**, using R12 scheme, **Any iOS Device (arm64)**, Product → Archive, and the existing R12 Digital Ltd automatic-signing team. Simulator compilation does not verify distribution signing/provisioning. Submission/upload readiness additionally depends on the materials and owner decisions above. No archive, upload, push, production merge or deployment was performed here.

# R12 Club — final native presentation and screenshots

Branding provenance corrected by `ClubBrandingRestoration.md`; use that report for the current project path and archive readiness. The remaining evidence here records the original presentation work.

Isolated branch `fix/r12-club-final-presentation`, worktree `/private/tmp/r12-club-final-presentation`, based on deployed `023c1f428c4e788663ebc2f83b66cd5325d541ec`. No push, merge, deployment, provider/environment/database change, archive replacement or Apple upload. Other worktrees and the submitted main R12 app remain untouched.

## Changes

- Removed Club's persistent native R12 Club title and Page options toolbar. Root destinations have no native header; a 44pt native Back row appears only on nested routes when history exists. Swipe-back and pull-to-refresh remain. Five native tabs and bottom safe-area inset remain intact; failed-load retry remains. Privacy is still accessible through Club's account/web routes.
- White Club launch storyboard with only the established R12 × Madhouse Club artwork centred, aspect fit, 144pt square. The authoritative asset is the native Club AppIcon-1024.png introduced in commit `2d05bda3c98ca1f0ca58e4cafa7f3525f9c2bc0b`; both launch and icon use SHA256 `b05e3c68caadca9fd8a3b97ca58eede30348b3f1f1ad7c718262fa12ea15b85c`. This supersedes the generic main R12 asset mistakenly used by the original 668983f launch pass. The existing 1024px asset is reused unchanged, with no regeneration/recreation/recolouring/upscaling. The whole-shell white loading overlay, centred across safe areas, prevents bottom navigation from appearing during launch.
- `app/club/layout.tsx`: corrected both first/full reviewer display names from App Review Demoer to App Review Demo; no authentication, entitlement or permissions change.
- Screenshot mode is enabled ONLY by the local process flag `R12_CLUB_SCREENSHOTS=1`, inside `#if DEBUG && targetEnvironment(simulator)`. Release and physical-device builds compile out the flag handling/loopback origin. The built Release app was scanned for both flag and URL, with neither present. Release Info.plist has no local-network ATS exception; only Debug uses Info-Debug.plist. No cookie, URL, server flag or production route can enable the native mode.
- Mode uses a non-persistent WKWebView connected solely to exact `http://127.0.0.1:3121`. It blocks every other navigation, external link and app deep link. The local fixture server listens on loopback only, uses existing synthetic reviewer data and real Club components, contains no Supabase configuration/authentication, replaces imported server actions with throwing sentinels, rejects non-GET/HEAD methods and unknown/API routes, and sends CSP prohibiting external connections/forms/frames. It never loads live member, staff or financial records. The synthetic £12.50 balance and example stock are local fixture values only.
- Only this local presentation hides demo banner/notice presentation. Genuine authenticated Apple reviewer mode in the normal app retains all notices and read-only restrictions. Normal native WKWebView uses the existing persistent store, so screenshot mode does not sign out or alter the reviewer's real session. Ordinary staff operation/security is unchanged.

## Four screenshots and exact capture procedure

Project: `/private/tmp/r12-club-final-presentation/ios/R12Club/R12Club.xcodeproj`, scheme **R12Club**, simulator **iPhone 17 Pro** (9018276F-4E67-4A43-AB5A-393BB7C73517).

Four 1206×2622 screenshots were generated from the real simulator: Reception, Daily Checks, Members, Shop. These are local synthetic presentation captures, not captures of a production data session or proof that a Release binary contains screenshot mode. Existing read-only components remain read-only and unsupported operations are not represented as working. More is also verified but is not one of the requested four images. Product/sample qualifiers intrinsic to fixture data remain truthful.

To repeat, from this worktree with Node dependencies and Xcode available:

```sh
cd /private/tmp/r12-club-final-presentation
bash ios/R12Club/capture-screenshots.sh
```

The script starts the loopback-only fixture server, builds/tests **Debug** on iPhone 17 Pro, captures the four tab screens through XCTest, exports the PNG attachments, names them `01-Reception.png`, `02-Daily-Checks.png`, `03-Members.png`, `04-Shop.png`, prints the unique output directory, and shuts down its own fixture server. It does not authenticate, query a real backend, archive, sign for distribution, upload or deploy. Port 3121 must be free; if it is occupied, identify/stop only the prior local fixture server rather than killing unrelated processes.

Optional variables: `R12_CAPTURE_OUTPUT` (new output directory), `R12_SIMULATOR_UDID` (another compatible iPhone simulator), `R12_CAPTURE_DERIVED_DATA` (reuse an existing Club-only derived-data path). Existing result bundles are never overwritten. The complete capture script was exercised end to end using `/private/tmp/r12-club-final-capture-script` and existing derived data. Final images and launch verification evidence are linked in the handoff.

For normal development/reviewer testing, launch Club without the screenshot flag. Do not manually hide notices in production or change the existing review account's role/password. Before uploading screenshots, owner should review that the representative synthetic UI matches the current submitted functionality and supply any other required device-size screenshots (the target still supports iPad).

## Validation

Full npm test: 1,347 passed, 1 skipped, zero failures (1,348 total). TypeScript, production web build, lint and iOS source validator passed. Lint retains the same three existing warnings in coach-account-actions, exercise-guide-sheet and training-app. Debug and Release Club simulator builds passed. All four final UI tests verify normal synthetic reviewer member/profile/native-back flow, web Menu-to-Daily-Checks selected-tab sync, five persistent tabs, and isolated local screenshot presentation without native navigation bar/options, with correct top layout and More/Glow Zone access. The initial capture assertion used static text for an accessible product button; that test assertion was corrected and rerun successfully. Local browser checks passed all five fixture pages, hidden local demo notice, no overflow/external requests, API/mutation denial and zero Shop server actions. Release binary flag/loopback absence and Release ATS settings were checked directly. Final git diff --check passed.

## Web deployment and archive readiness

**A small web deployment is still needed for the two reviewer-label strings in app/club/layout.tsx.** It is prepared only; no deployment is authorised here. Native header/launch changes need a new Club binary, not a web deployment. Local screenshot generation works independently of that web deployment. Integration should carry only the two display-string edits onto the then-current production web baseline, retaining the existing Club privacy release; do not replace newer production code.

Bundle `live.r12.club`, version 1.0.0/build 1, iOS 17+, team79ZP9U47SK and existing Manual Release profile `R12 Club App Store Distribution` are preserved. Release source compiles and screenshot mode is excluded, but this task does NOT certify distribution signing: create a NEW signed Release device archive and run Organizer Validate App after owner review. Do not reuse a Debug/simulator build or overwrite the previously prepared archive. Confirm build-number availability in App Store Connect; no Apple record was accessed. Main R12, Coach, Glow Zone and shared native sources are byte-identical to baseline. No Stripe/Supabase configuration, production record or account permission was changed. Existing privacy/provider/legal/deletion-fulfilment decisions remain separate from this presentation work.

## Exact files changed

- `app/club/layout.tsx`
- `ios/R12Club/App/ClubNativeShell.swift`
- `ios/R12Club/App/LaunchScreen.storyboard`
- `ios/R12Club/R12Club.xcodeproj/project.pbxproj`
- `ios/R12Club/Tests/ClubNavigationUITests.swift`
- `ios/scripts/validate.mjs`
- `tests/browser/club-reviewer-harness.tsx`
- `tests/browser/run-club-reviewer.mjs`
- `tests/club-ios-release.test.ts`
- `tests/club-review-polish.test.ts`
- `ios/R12Club/App/Assets.xcassets/LaunchLogo.imageset/Contents.json`
- `ios/R12Club/App/Assets.xcassets/LaunchLogo.imageset/logo.png`
- `ios/R12Club/App/Info-Debug.plist`
- `ios/R12Club/capture-screenshots.sh`
- `tests/club-final-presentation.test.ts`
- `ios/R12Club/FinalNativePresentation.md` (this report).

## Final evidence

- Four latest screenshots: `/private/tmp/r12-club-final-captures/01-Reception.png`, `02-Daily-Checks.png`, `03-Members.png`, `04-Shop.png` (1206×2622).
- Final white-logo launch recording: `/private/tmp/r12-club-final-centred-launch.mov`; extracted unaltered frame: `/private/tmp/r12-club-final-captures/launch-white-logo.png`.
- Final UI evidence: `/private/tmp/r12-club-final-submission.log` and `/private/tmp/r12-club-final-submission.xcresult`: four passed, zero failures/skips.
- `/private/tmp/r12-club-final-tests-verified.log`: 1,347 passed, 1 skipped, zero failures.
- Other logs: `/private/tmp/r12-club-final-web-build.log`, `r12-club-final-typescript.log`, `r12-club-final-lint.log`, `r12-club-final-release-build.log`, `r12-club-final-browser.log`, `r12-club-final-validator.log`.
- Capture procedure evidence: `/private/tmp/r12-club-final-capture-script.log`; repeatable script also produced four images successfully.

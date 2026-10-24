# R12 Club — final navigation and App Review polish

24 October 2026. Isolated branch `fix/r12-club-ios-review-polish`, worktree `/private/tmp/r12-club-ios-review-polish`, based on `344b29efcf41f908086629de0c7203711d487f8e` (includes Club preparation `fcc297e` and the complete public privacy fix). This report supersedes the navigation, signing and reviewer-presentation caveats in SubmissionReadiness.md; that earlier report remains historical evidence.

## Result and boundaries

Local implementation and validation complete. No push, merge, deployment, Apple upload, provider/configuration change or production data mutation. Existing owner changes in other worktrees are preserved. Main R12, Coach, Glow Zone and shared native sources are unchanged. No QR implementation. Existing privacy page, its public route and proxy protections match both `344b29e` and web privacy integration `1ac373f` byte for byte.

## Navigation and reviewer experience

Before: Reception / Daily Checks / Inductions / Overview / More.
After: **Reception / Daily Checks / Members / Shop / More**.

Club's entry now uses a Club-only shell with one persistent default-cookie WKWebView, native bottom UITabBar, native back, swipe-back, pull-to-refresh, reload/privacy menu, retry overlay and dark safe areas. Actual same-origin route changes, including Next.js pushState/replaceState and browser back, update the selected tab. Nested member profiles retain Members; shop/products/promotions retain Shop; other Club destinations select More. Authentication pages retain the last tab. Tab navigation retains organisation/location context and does not propagate unrelated query tokens. HTTPS production origin and app-scoped auth callback query/fragment handling are preserved. No existing shared shell file was edited.

Reception and Daily Checks retain their existing routes and components; real staff check-in/check completion, permissions and station boundaries were not changed. Members opens the actual existing ClubMembersDirectory; the reviewer uses synthetic records and the existing read-only profile presentation extracted into ClubReviewerMember. No new member database or persistence layer. The directory is no longer combined with Overview in the Members route.

Menu and More render the same ClubMenuLinks component and central clubNavigationLinks definitions. Managers retain Finance, Reports, Locations, Staff, Shared stations and Launch readiness. Ordinary operational staff retain the operational destinations; direct server checks remain authoritative. Glow Zone and Inductions remain in More. Schedule is independent staff/PT scheduling and is retained as **Staff & PT schedule**, separate from Classes. More is now a navigation page available within the authenticated resolved organisation rather than an administration-only page; this grants no destination permissions. The reviewer More page uses the same component with fixture staff presentation only.

The reviewer shop was empty because physical demo products lacked availability/stock and the screen used the consumer presentation. It now uses the existing staff shop component with explicit synthetic stock and POS/online fixture channels. Products: Apocalypse Nutrition Shaker £8.00 (12 sample stock), Per4m Isolate Zero £39.99 (8), NOCCO Electrolyte £2.50 (24), existing product imagery and categories. No inventory writes. Reconciliation remains unavailable; demo submit exits before any server action and cannot make orders/payments. Ordinary staff/consumer behaviour stays unchanged outside demo-specific presentation.

Club review labels now read **App Review Demo** and **DEMO ACCOUNT - READ ONLY**, with a compact single read-only notice. Duplicate staff shop disclaimer/cash-verification sections are omitted in demo mode. Existing non-Club consumer demo wording is preserved. Reviewer identity/entitlement enforcement, Club request rewrites, blocked APIs/actions, capability checks and station protections are unchanged.

## Validation actually performed

- Full `npm test`: **1,344 passed, 1 skipped, 0 failed** (1,345 total). Includes reviewer isolation/security, public privacy, roles and navigation regression coverage.
- Focused checks: 33 passed before final full-suite run.
- `tsc --noEmit`: passed. `npm run build`: passed after removing a stale Members/Overview title condition found by TypeScript.
- `npm run lint`: passed, 0 errors; 3 pre-existing warnings in coach-account-actions, exercise-guide-sheet and training-app.
- `git diff --check`: passed. iOS source configuration validator: passed.
- Club Release simulator build: passed, signing disabled for simulator only.
- Foundation routing executable: 14 destinations plus auth fallback and query-context checks passed.
- Final iPhone 17 Pro simulator XCTest run: **3 passed, 0 failed, no skips**. Five tabs remain persistent and selected correctly; existing confirmed synthetic reviewer member list → profile → native back; web Menu → Daily checks updates native selection. Used existing session only, no sign-in submission, credentials access or real record mutation.
- Local mobile browser fixture using actual shared menu, directory/profile and shop components: passed Menu/More link equality, staff/owner Finance visibility, search → profile → back, all 3 products, and demo submit with **zero server actions**. Imported server actions are throwing sentinels, not fabricated provider responses. This test is a local fixture, not a deployed application test.

Evidence under `/private/tmp`: `r12-club-polish-tests-final.log`, `r12-club-polish-typescript.log`, `r12-club-polish-build-final.log`, `r12-club-polish-lint-final.log`, `r12-club-polish-validator.log`, `r12-club-polish-simulator.log`, `r12-club-polish-ui-guarded.log`, `r12-club-polish-ui-guarded.xcresult`, `r12-club-polish-browser-final.log`, `r12-club-polish-browser/shop-mobile.png`. Browser reproduction: `R12_PLAYWRIGHT_MODULE=/private/tmp/r12-browser-check/node_modules/playwright/index.mjs node tests/browser/run-club-reviewer.mjs`; requires existing Playwright/Chrome and esbuild. No package/lockfile change.

## Signing and release steps still required

Resolved Release device settings: **live.r12.club**, **1.0.0 (1)**, team **79ZP9U47SK**, Manual, **iPhone Distribution**, profile **R12 Club App Store Distribution**, iOS 17+, iPhone and iPad. Manual Release selection was carried from the owner's current Club preparation worktree; Debug remains automatic. No signing certificates or profiles were changed. ShowBuildSettings confirms the resolved selection, not successful distribution signing.

1. Review this commit and integrate only its Club web changes with the existing privacy release on the then-current production baseline. Preserve public `/club/privacy` and all proxy/station/reviewer protections. This branch includes native preparation history and must not be blindly substituted for a newer production branch.
2. Separately authorise protected preview and production deployment. Verify privacy/support contact/deletion text, Menu/More, three shop products, synthetic member profiles and ordinary staff/manager role boundaries using authorised access without real writes. Existing privacy release preview protection previously blocked automated inspection; no protection was disabled here.
3. New web UI has only been tested locally; simulator runtime tests loaded the current production web app using the existing synthetic session. **Do not describe the updated shop/More/presentation as deployed or use the local fixture screenshot as a final App Store screenshot.** After approved web deployment, repeat the full reviewer walkthrough on the rebuilt Club app and capture actual iPhone 17 Pro screenshots; also check iPad because the target supports it.
4. Open this worktree's Club Xcode project, select R12Club/Any iOS Device, confirm the existing distribution profile and build-number availability in App Store Connect, then create a NEW signed Release archive and validate it. Existing prepared archives were not modified. This task built the simulator, not a new signed distribution archive. Do not rebuild or upload the main R12 app.
5. Owner uploads/submits Club only when the above passes. Use reviewer notes describing the five new tabs, More for Inductions/Classes/Glow Zone and synthetic read-only examples. Keep the password only in Apple's credential fields. No promises of working real financial, access or write actions in the demo.

## Remaining owner decisions

The prior AppPrivacyCorrections.md still applies: confirm retained diagnostics/crashes/performance and provider settings, actual financial fields, image/support attachments, active providers/transfers/retention, tracking practices, health-data legal grounds reachable via shared account, and actual deletion-request fulfilment. This UI change does not resolve those legal/operational questions or certify App Privacy accuracy. The public privacy fix still needs its separately approved live deployment/verification. Dates in synthetic schedules should be checked at submission time. Device-family screenshots, signed archive validation and Apple listing/build selection remain owner actions.

## Exact files changed in this polish commit

- `app/club/layout.tsx`
- `app/club/more/page.tsx`
- `app/club/reviewer/[[...screen]]/page.tsx`
- `components/club-class-register.tsx`
- `components/club-operations.module.css`
- `components/club-shell.module.css`
- `components/club-shell.tsx`
- `components/club-shop.tsx`
- `ios/R12Club/App/App.swift`
- `ios/R12Club/R12Club.xcodeproj/project.pbxproj`
- `ios/R12Club/R12Club.xcodeproj/xcshareddata/xcschemes/R12Club.xcscheme`
- `ios/scripts/validate.mjs`
- `lib/play-reviewer-club-data.ts`
- `tests/club-ios-release.test.ts`
- `tests/club-mobile-layout.test.ts`
- `tests/club-operations-v2.test.ts`
- `tests/club-play-reviewer.test.ts`
- `tests/club-products-navigation.test.ts`
- `components/club-menu-links.tsx`
- `components/club-reviewer-member.tsx`
- `ios/R12Club/App/ClubNativeShell.swift`
- `ios/R12Club/App/ClubNavigation.swift`
- `ios/R12Club/Tests/ClubNavigationUITests.swift`
- `lib/club-navigation.ts`
- `tests/browser/club-reviewer-harness.tsx`
- `tests/browser/run-club-reviewer.mjs`
- `tests/club-review-polish.test.ts`
- `ios/R12Club/FinalReviewPolish.md` (this report).

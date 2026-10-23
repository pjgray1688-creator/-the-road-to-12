# R12 first simulator corrections — 23 October 2026

Scope: R12 iPhone app and directly shared web components. No production data, providers, financial flows, infrastructure, releases, pushes or merges are authorised by this task.

## Findings and implementation

- R12's first configured destination was `/training`. It is now `/`, followed by Training, Progress and Account. The root page is the independent R12 fitness dashboard; connected gym features remain under Member Hub.
- The previous shared shell made a separate WKWebView for each native tab. R12 now uses one persistent WKWebView in a SwiftUI NavigationStack with an Apple UITabBar hosted through UIViewRepresentable. Existing Club, Coach and Glow Zone shells retain their existing destinations and controls. Native selection observes the actual WKWebView URL, including client history changes. History maps to Progress; coaching workspace and policy pages map to Account; gym pages map to Home.
- Main R12 alone injects a first-party, main-frame document-start marker. It is not based on query strings, browser user-agent guesses, cookies or persisted browser state. Scoped selectors hide explicitly tagged member web navigation and the existing exact member navigation class/ARIA-label combinations, and remove their web-bottom-navigation allowance. The native-injected stylesheet supports the currently deployed markup without requiring a web release. Native safe areas reserve the tab bar; keyboard dismissal remains interactive. The marker controls presentation only and conveys no permissions.
- The R12 native header now has one R12 identity, a conditional back control and a page-options menu. The former hand icon was the privacy shortcut, not a debug tool. Privacy and reload remain in the menu, pull-to-refresh and swipe-back remain available, and failed loads offer retry.
- Successful password sign-in in the main R12 shell returns Home even when the web login has a `next` route. Ordinary web/PWA and other products keep their existing return destinations. New-account onboarding and password recovery remain intact. Supabase operations are deferred out of the auth callback; fresh sessions clear stale warnings and an older outstanding refresh cannot sign out a new sign-in attempt.
- Authorised coaches can open their existing workspace from R12 Account without a permanent Coach tab. Server coaching permissions, client relationships and member assigned training are unchanged.
- Shared PasswordInput adds hidden-by-default visibility, eye controls, screen-reader labels, pressed state and a 44px control. Existing values, validation, autocomplete and password-manager attributes remain with the input. Sign-in, registration, reset, deletion confirmation and staff password confirmation use it. Numeric Club PIN entry intentionally remains unchanged.
- The launch storyboard's background used invalid component values `07`, `0a`, `0d`, explaining its incorrect red appearance. Valid decimal charcoal values replace them; the existing R12 logo is reused in a LaunchLogo asset. No artificial splash timer was introduced.
- R12 alone targets iPhone (`TARGETED_DEVICE_FAMILY = 1`). Bundle ID, 1.0.0/build 1, iOS 17 minimum and automatic signing remain. Team 79ZP9U47SK is preserved from the owner's uncommitted Xcode project. It is an identifier, not a credential. Other app signing settings are unchanged.

## Startup and runtime warnings

The source has no deliberate 40-second native splash delay. Home also had an indefinite loading path when its authoritative workout request failed; it now presents an error and retry, with regression coverage. The previous first route required Training authentication before reaching the dashboard; multiple web views could restore authentication independently. Those avoidable paths are removed for R12. Existing initial home session restoration already has loading/retry feedback. Debug WebNavigation logs now report navigation-start/document-loaded duration without URLs, credentials or personal data. Document-loaded timing is not a first-meaningful-render metric.

This session observed substantial XProtect CPU while Xcode's simulator build helpers were waiting on first execution. That is evidence of host build overhead, not proof of the cause of the owner's original 40-second launch. Cold versus warm startup still needs measured runs with the final native and web changes together.

The original WebKit warning messages/stacks were not supplied. Privacy/restricted-domain diagnostics, image reader messages and text input session warnings cannot be classified conclusively from their categories alone. Do not disable ATS, privacy checks or system protection to silence them. Reproduce and correlate exact messages with failed requests, missing images or broken input before calling them harmless. ATS remains restrictive.

## Submission decisions and external dependencies

1. **4.2 minimum functionality:** native navigation and recovery improve the experience but do not guarantee approval of this web-led fitness application. Demonstrate usable training, history, wearable information and independent account access on device, with review credentials supplied securely by the owner.
2. **Digital products:** separately review any R12 digital training subscriptions, premium content or remote digital coaching purchase paths under 3.1.1 and applicable storefront rules. No Stripe routing, checkout, financial flows or entitlements were changed. Physical goods, in-person classes and physical gym memberships remain existing external-payment services; explain the distinction in review notes.
3. **Account deletion:** Account retains the in-app deletion-request flow. Verify the deployed operator, completion communication, retention disclosures and realistic completion time without deleting real user data for testing.
4. **Privacy:** the 1024px app icon and launch logo are present. `sips` verifies the App Store icon is 1024×1024 with no alpha channel. No native PrivacyInfo.xcprivacy exists. Audit the final archive and enabled native SDK/API usage to decide required-reason declarations; do not invent reasons or declare data uncollected. Final privacy labels must cover account, training/health, WHOOP and relevant provider processing. Confirm actual support/policy contacts and listing metadata.
5. **Combined verification:** web changes are local only. Native navigation hiding and content padding also support the deployed markup. The production-hosted WKWebView still needs an approved web deployment for the password controls, revised sign-in behavior, coach Account link and Home error recovery to be verified together in production. Do not expect rebuilding native alone to publish website changes.
6. **Device validation:** real-device sign-in/out, expired sessions, recovery deep links, final scroll controls, keyboard focus, WHOOP, gym/shop/classes/access and coach relationships still require the final combined build. Do not create demo transactions or fabricate provider results.

Sources checked 23 October 2026: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Apple account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).

## Open and rerun on this iMac

1. Keep the original `/Users/r12/-the-road-to-12` checkout and its uncommitted Xcode edits intact. This task lives in `/private/tmp/r12-ios-first-simulator` on `fix/r12-ios-first-simulator`, based on integration commit `95abe94`. Its iOS tree matches the supplied preparation commit `84674bf`, although that commit is not an ancestor of the current integration head.
2. Open `/private/tmp/r12-ios-first-simulator/ios/R12/R12.xcodeproj` in Xcode 26.1.1. Select the **R12** scheme and **iPhone 17 Pro (iOS 26.1)** destination.
3. Under Signing & Capabilities, verify **Automatically manage signing** and **R12 Digital Ltd**. Do not change the bundle identifier `live.r12.training` or create new Apple identifiers.
4. Choose Product → Run (Command-R). Use Product → Clean Build Folder only if Xcode retains the old launch asset; do not uninstall or erase the simulator merely to clear an image, because that discards authentication data.
5. Confirm Home is first, then test Training, Progress and Account, internal links, swipe-back, reload/retry and long-page final controls. Test signed-out and fresh-sign-in destinations, password toggles and keyboard focus. Repeat cold/warm launches and compare WebNavigation logs.
6. Review and approve web delivery separately before expecting the full set of shared web fixes at `app.r12.live`. No deployment or App Store submission is performed by this task.



## Validation results

- `node ios/scripts/validate.mjs`: passed across all four app configurations.
- `npm test`: 1,318 discovered; 1,317 passed, 0 failed, 1 skipped. The skipped Active Sports integration test requires a disposable local PostgreSQL database with repository migrations. No production database was used to enable it.
- `npm run build`: passed on the final web changes. The first attempt with a cross-worktree node_modules symlink failed Turbopack root detection; isolated locked dependencies resolved it.
- `node node_modules/typescript/bin/tsc --noEmit`: passed; the final production build also type-checked the final web changes.
- `npm run lint`: passed with three existing warnings: internal `window.location.assign` in coach-account-actions and two `img` warnings in exercise-guide-sheet/training-app. No lint errors.
- `git diff --check`: passed.
- Four focused regression tests: passed, including first-party-only injection, early-document handling, scoped browser navigation and Home failure/retry behavior.
- Temporary DOM interaction test of the real PasswordInput: passed hidden/reveal/hide, retained value/focus, ARIA labels/pressed state, autocomplete and validation attributes. Temporary Chromium layout checks passed browser navigation visibility, native-only hiding, 24px content padding, long-page final-control visibility and input entry. The actual native injection also passed against the deployed legacy markup fixture. These are local fixtures, not claims of end-to-end production auth or software-keyboard testing.
- `bash ios/scripts/build-simulators.sh`: all four unsigned simulator targets built successfully. Latest R12 changes also passed a separate Xcode 26.1.1 iPhone 17 Pro / iOS 26.1 build. Existing other-app launch storyboard Dynamic Type warnings and AppIntents metadata-skip warnings remain; the R12 storyboard's removed text labels do not generate those font warnings.
- Simulator launch restored the pre-existing R12 session, showed Home selected, the fitness dashboard, wearable information and connected gym area. No fresh-login credentials or destructive account/commerce flows were exercised.
- Native UI test target `R12NavigationUITests` is included in the R12 scheme. Its first run exposed a test-setup issue: accepting a pending external training link correctly navigated to Training, so its cold-launch Home assertion failed. All tab taps and back-to-Account assertions passed during that run. Setup now dismisses the pending prompt before a fresh launch; the final rerun passed: 1 native UI test, 0 failures, 28.097 seconds. Cold-launch Home, exactly four tabs, every tab selection and back-to-Account selection were exercised.

## Rerun native navigation regression

In Xcode select R12 and the iPhone 17 Pro simulator, then Product → Test (Command-U). This tests cold-launch Home, exactly four tabs, no Coach tab, tab switching and back navigation updating selected tabs. It uses normal application navigation and does not submit forms or purchase anything. Authentication, provider operations, keyboard/safe-area behavior on a real device, sign-out/fresh-login and the combined deployed web changes still require owner validation.

## Files changed

- `app/account/page.tsx`
- `app/account/reset/page.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/training/page.tsx`
- `app/training/preview/preview-client.tsx`
- `app/tutorial/coach/page.tsx`
- `app/tutorial/member/page.tsx`
- `components/account-deletion-request.tsx`
- `components/app-nav.tsx`
- `components/club-pin-settings.tsx`
- `components/home-shell.tsx`
- `components/ios-coach-access.tsx`
- `components/password-input.tsx`
- `components/privacy-deletion-queue.tsx`
- `components/training-app.tsx`
- `components/ui.tsx`
- `ios/AppStoreConnect/FirstSimulatorFixes.md`
- `ios/R12/App/Assets.xcassets/LaunchLogo.imageset/Contents.json`
- `ios/R12/App/Assets.xcassets/LaunchLogo.imageset/logo.png`
- `ios/R12/App/LaunchScreen.storyboard`
- `ios/R12/R12.xcodeproj/project.pbxproj`
- `ios/R12/R12.xcodeproj/xcshareddata/xcschemes/R12.xcscheme`
- `ios/R12/Tests/R12NavigationUITests.swift`
- `ios/README.md`
- `ios/Shared/AppConfiguration.swift`
- `ios/Shared/NativeAppShell.swift`
- `ios/Shared/RouteWebScreen.swift`
- `ios/scripts/validate.mjs`
- `tests/ios-member-shell.test.ts`

## Delivery state

Work is isolated on `fix/r12-ios-first-simulator`; the original integration worktree still has its original uncommitted Xcode project and workspace changes. The task is committed locally with message `fix(ios): refine R12 member navigation and release preparation`. Nothing was pushed, merged, deployed or submitted to Apple. No migrations, production SQL, provider settings, secrets or financial operations were executed.

The app is **not declared submission-ready**: the shared web changes need approved delivery and combined auth/device validation; the original 40-second delay and warning categories are not conclusively resolved; final privacy, support metadata, payment classification and Apple review decisions remain open.

# Club branding restoration — release handoff

Isolated branch: `fix/r12-club-branding-restoration`.
Worktree: `/private/tmp/r12-club-branding-restoration`.
Xcode project: `/private/tmp/r12-club-branding-restoration/ios/R12Club/R12Club.xcodeproj`.
Base: `668983f15e4217cffef804ff54e287f1ebbc65e6`, retaining all approved native/header/navigation/local screenshot work and both reviewer-label string corrections.

## Actual history and correction

The first native Club project in 3e2566d used the generic R12 image. Commit `2d05bda3c98ca1f0ca58e4cafa7f3525f9c2bc0b` deliberately replaced the Club app icon with the established **R12 × Madhouse** artwork. Its native PNG blob is `cb991327e6013c08e77898e5bfdeffa6366e2144`, SHA256 `b05e3c68caadca9fd8a3b97ca58eede30348b3f1f1ad7c718262fa12ea15b85c`.

The 668983f presentation pass did not change that app icon, but mistakenly used the main R12 image for the new launch image. That was the branding regression. Both the installed icon and launch now use the exact historical Club PNG, 1024×1024 with no alpha. The app icon was already byte-identical to the correct historical source; it was retained/reinstalled and visually verified rather than substituted with another design. The launch image is replaced byte for byte from the historical native Club asset, and storyboard image metadata now correctly says 1024×1024. No new artwork, generation, image recreation, crop, recolour or resizing.

Git history does not contain a pre-668 image-based Club launch layout: earlier Club launch storyboards were text-based. The restoration therefore uses the established Club artwork in the completed white layout, rather than inventing a claimed earlier image-based launch implementation. White background, exact centring, aspect fit, no additional storyboard text and the whole-shell logo loading overlay with no bottom tabs remain unchanged. The native R12 Club title/options header remains removed, nested native Back and all five tabs remain intact.

## Minimal changes from 668983f

- `ios/R12Club/App/Assets.xcassets/LaunchLogo.imageset/logo.png`: replace incorrect generic image with exact historical Club artwork.
- `ios/R12Club/App/LaunchScreen.storyboard`: image resource dimensions 512→1024; no layout/background change.
- `tests/club-final-presentation.test.ts`: guard both icon and launch against the historical Club asset fingerprint.
- `ios/R12Club/Tests/ClubNavigationUITests.swift`: find/open the installed R12 Club home-screen icon and retain a visual attachment.
- `ios/R12Club/FinalNativePresentation.md`: correct earlier logo provenance and point to this current handoff.
- This report.

No NativeShell, signing/project settings, app icon source, main R12, Coach, Glow Zone, shared native, API, database, auth/security/provider/configuration change relative to the approved presentation base. No production data, Stripe or Supabase operation. No push, merge, deployment, archive replacement or Apple upload.

## Screenshots preserved

The four approved files in `/private/tmp/r12-club-final-captures` are untouched: 01-Reception.png, 02-Daily-Checks.png, 03-Members.png, 04-Shop.png. SHA256 values were captured before work and compared after validation; all four remain byte-identical. There is no visible in-app defect requiring recapture, as only launch branding changed. The normal local-screenshot test was explicitly excluded from this correction's simulator run, so the four were not recaptured.

New icon/launch verification evidence is separate under `/private/tmp/r12-club-branding-verification`, with original icon screenshot attachment in `/private/tmp/r12-club-branding-ui.xcresult`. The native icon was observed on the iPhone 17 Pro home screen and opened successfully. The launch recording uses the local synthetic fixture and never loads real member/staff/financial data.

## Validation

- Actual full npm test: **1,347 passed, 1 skipped, zero failures** (1,348 total).
- Production web build, TypeScript, lint and iOS source validation passed. Lint retains the same 3 existing warnings in coach-account-actions, exercise-guide-sheet and training-app.
- **Debug simulator build/tests passed on iPhone 17 Pro**: installed Club icon, normal reviewer synthetic member profile/back, Menu → Daily Checks native selection, and five persistent tabs. Four tests, zero failures. Local screenshot capture test excluded intentionally.
- **Unsigned Release device build passed**, generic iOS/iphoneos. Packaged bundle live.r12.club, version1.0.0/build1. Screenshot flag/loopback functionality and Debug local-network exception remain absent from the Release device app.
- Historical artwork fingerprints, 1024px/no-alpha assets, white/aspect-fit launch source, retained header/navigation, preserved original screenshots and git diff --check verified.

Evidence: `/private/tmp/r12-club-branding-{tests,build,typescript,lint,validator,ui,release-build}.log`. Existing four screenshot evidence is unchanged; new verification does not replace it.

## Reviewer label and release integration

Both `App Review Demoer` → `App Review Demo` first/full-name display-string corrections are inherited intact from 668983f in app/club/layout.tsx. They are part of this clean release branch, not lost or independently rewritten. Only those two strings need a separately approved web deployment onto the then-current production baseline; no web deployment is needed for native artwork. No production deployment occurred here. The current production web release remains independent of this prepared native branch.

## Signing and archive readiness

Preserved: live.r12.club, version1.0.0/build1, iOS17+, team79ZP9U47SK, existing Manual Release signing and profile `R12 Club App Store Distribution`. Read-only local checks found a valid distribution identity for that team and an unexpired distribution profile with the matching bundle/team. No certificate/profile/private key was modified or newly registered.

The unsigned Release device build succeeds and signing prerequisites are present. **Ready to create a NEW signed Club Release archive for validation**, subject to confirming the intended build number is available in App Store Connect. Open this report's Xcode project, choose R12Club and Any iOS Device, confirm existing Manual distribution settings, Product → Archive, then Organizer Validate App. Signing itself and Organizer validation were not executed here; do not describe this unsigned build as signed/upload-ready. Do not overwrite an old prepared archive or build/upload the main R12 app. Owner alone performs the separately authorised upload/submission. No other UI work or Apple record change is included.

## Visual evidence

- Installed icon, iPhone 17 Pro home screen: `/private/tmp/r12-club-branding-verification/installed-club-icon.png`.
- Actual centred Club-logo launch frame, white background and no bottom navigation: `/private/tmp/r12-club-branding-verification/launch-club-logo.png`.
- Original launch recording: `/private/tmp/r12-club-branding-launch-verified.mov`.
- Existing approved four screenshot hash baseline: `/private/tmp/r12-club-branding-screenshots-before.json`; all four hashes still match.

# Club branding restoration — release handoff

Isolated branch: `fix/r12-club-branding-restoration`.
Worktree: `/private/tmp/r12-club-branding-restoration`.
Xcode project: `/private/tmp/r12-club-branding-restoration/ios/R12Club/R12Club.xcodeproj`.
Base: `668983f15e4217cffef804ff54e287f1ebbc65e6`, retaining all approved native/header/navigation/local screenshot work and both reviewer-label string corrections.

## Approved source and correction

The previous restoration selected historical R12 × Madhouse artwork. That tenant-specific image is not the standalone R12 Club product brand and has been removed from both native asset slots.

The owner supplied the approved source at `/Users/r12/Downloads/Glossy R12 Club Emblem(1).png`. It is a 1254×1254 PNG containing the standalone purple-and-silver R12 emblem with CLUB, no Madhouse wording and no customer-specific brand. Source SHA256: `c3260ddbad15a09d540b3e4e6bf0c4dbe3c69c4893ab18cd79274b25358d08ab`.

Apple requires a 1024×1024 opaque app icon. The source was scaled square to 1024×1024 and flattened onto pure white to remove the alpha channel. It was not redrawn, recoloured, cropped, generated or replaced. The resulting RGB PNG has SHA256 `2609f358a78362e470375bcabb8ec0a827a83e4580e60a0aa06a360d9d8cfdd3` and is used byte-for-byte for both `AppIcon-1024.png` and `LaunchLogo.imageset/logo.png`.

The launch layout remains pure white, centred and aspect-fit, with no copy or bottom navigation during launch/loading. The native title/options header remains removed; nested Back and all five tabs remain intact.

## Focused branding changes

- `ios/R12Club/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`: replace tenant artwork with the approved standalone Club source conversion.
- `ios/R12Club/App/Assets.xcassets/LaunchLogo.imageset/logo.png`: use the same approved standalone Club source conversion.
- `ios/R12Club/App/LaunchScreen.storyboard`: update the image accessibility label to R12 Club; preserve layout and white background.
- `tests/club-final-presentation.test.ts`: pin both packaged assets to the approved output fingerprint.
- `ios/R12Club/FinalNativePresentation.md` and this report: record the corrected source and provenance.
- This report.

No NativeShell, signing/project settings, main R12, Coach, Glow Zone, shared native, API, database, auth/security/provider/configuration change. No production data, Stripe or Supabase operation. No push, merge, deployment, archive replacement or Apple upload.

## Screenshots preserved

The four approved files in `/private/tmp/r12-club-final-captures` are untouched: 01-Reception.png, 02-Daily-Checks.png, 03-Members.png, 04-Shop.png. SHA256 values were captured before work and compared after validation; all four remain byte-identical. There is no visible in-app defect requiring recapture, as only launch branding changed. The normal local-screenshot test was explicitly excluded from this correction's simulator run, so the four were not recaptured.

New icon/launch verification evidence is separate under `/private/tmp/r12-club-branding-corrected-evidence`. The native icon was observed on the iPhone 17 Pro home screen, opened successfully and retained by `/private/tmp/r12-club-branding-corrected-icon-2.xcresult`. The actual `live.r12.club` launch/loading view was held using only a loopback socket and never loaded real member, staff or financial data.

## Validation

- Actual full npm test: **1,347 passed, 1 skipped, zero failures** (1,348 total).
- Production web build, lint and iOS source validation passed. Lint retains the same 3 existing warnings in coach-account-actions, exercise-guide-sheet and training-app.
- Eight focused Club presentation/release/reviewer tests passed. **Debug simulator build and installed-icon UI test passed on iPhone 17 Pro**: the installed icon was found on SpringBoard, captured, tapped and the app's native tab bar appeared. The unchanged navigation source retains the approved five tabs and nested Back behavior.
- **Unsigned Release device build passed**, generic iOS/iphoneos. Packaged bundle live.r12.club, version1.0.0/build1. Screenshot flag/loopback functionality and Debug local-network exception remain absent from the Release device app.
- Approved source/output fingerprints, 1024px/no-alpha assets, white/aspect-fit launch source, retained header/navigation, preserved original screenshots and git diff --check verified.

Evidence: `/private/tmp/r12-club-branding-corrected-{tests,web-build,lint,build,release,icon-2}.log`, `/private/tmp/r12-club-branding-corrected-icon-2.xcresult`, and `/private/tmp/r12-club-branding-corrected-evidence`. Existing four screenshot evidence is unchanged; new verification does not replace it.

## Reviewer label and release integration

Both `App Review Demoer` → `App Review Demo` first/full-name display-string corrections are inherited intact from 668983f in app/club/layout.tsx. They are part of this clean release branch, not lost or independently rewritten. Only those two strings need a separately approved web deployment onto the then-current production baseline; no web deployment is needed for native artwork. No production deployment occurred here. The current production web release remains independent of this prepared native branch.

## Signing and archive readiness

Preserved: live.r12.club, version1.0.0/build1, iOS17+, team79ZP9U47SK, existing Manual Release signing and profile `R12 Club App Store Distribution`. Read-only local checks found a valid distribution identity for that team and an unexpired distribution profile with the matching bundle/team. No certificate/profile/private key was modified or newly registered.

The unsigned Release device build succeeds and signing prerequisites are present. **Ready to create a NEW signed Club Release archive for validation**, subject to confirming the intended build number is available in App Store Connect. Open this report's Xcode project, choose R12Club and Any iOS Device, confirm existing Manual distribution settings, Product → Archive, then Organizer Validate App. Signing itself and Organizer validation were not executed here; do not describe this unsigned build as signed/upload-ready. Do not overwrite an old prepared archive or build/upload the main R12 app. Owner alone performs the separately authorised upload/submission. No other UI work or Apple record change is included.

## Visual evidence

- Installed icon, iPhone 17 Pro home screen: `/private/tmp/r12-club-branding-corrected-evidence/icon-attachments-2/A69962A6-A574-4F1D-BDCB-C0D4A5F0F40A.png`.
- Actual `live.r12.club` centred Club-logo loading frame, pure white background and no bottom navigation: `/private/tmp/r12-club-branding-corrected-evidence/launch-loading-live-bundle.png`.
- Existing approved four screenshot hash baseline: `/private/tmp/r12-club-branding-screenshots-before.json`; all four hashes still match.

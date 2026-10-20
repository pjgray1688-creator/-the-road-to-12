# R12 iOS release preparation

Four standalone SwiftUI/Xcode app projects reuse the existing Next.js application at `https://app.r12.live`. Each has its own bundle ID, icon, launch screen, tab navigation and app-scoped URL scheme. The authenticated Next.js route remains responsible for account sign-in, staff/coach permissions, membership and customer data. `WKWebView` uses its persistent default website store so a session remains available between tabs and launches. External HTTPS links open in Apple's in-app Safari view; only `app.r12.live` stays inside the app web view.

The native tab bar, route-level navigation, back/reload/share controls, loading/error recovery, app-specific entry points, and separate staff/coach/member/customer identities make these focused companion apps around the existing interactive product. They do not duplicate business rules or elevate client-side permissions. App Review evaluates minimum functionality and similar apps individually; four separate listings still need clear, distinct audience and workflow evidence. See [App Review Guidelines 4.2 and 4.3](https://developer.apple.com/app-store/review/guidelines/).

## App identities

| App | Bundle ID | First route | Native destinations |
| --- | --- | --- | --- |
| R12 | `live.r12.training` | `/training` | Training, Progress, Account |
| R12 Club | `live.r12.club` | `/club/reception` (server redirect to `/club/access`) | Reception, Members, Schedule, More |
| R12 Coach | `live.r12.coach` | `/coach` | Workspace, Diary, Programmes, Account |
| Glow Zone | `live.r12.glowzone` | `/glow-zone` | Glow Zone, R12 Account |

R12 Club intentionally has no Member Hub destination. Reception still selects an organisation/location and checks staff permissions on the server. Coach, Glow Zone and account routes preserve their existing sign-in/redirect rules. Custom URL schemes are `r12-training:`, `r12-club:`, `r12-coach:` and `r12-glowzone:`; each rejects paths outside its route scope. Universal Links are not claimed or configured here because they require an Apple App Site Association response and an Associated Domains entitlement on the verified app host.

## Build on the owner's Mac

Install/select full Xcode (not only Command Line Tools), install its iOS platform components, and open Xcode once to accept its licence. Then run an unsigned Simulator build of all four projects:

```sh
cd ios
./scripts/build-simulators.sh
```

For signed release archives, sign in to the organisation's Apple Developer account in Xcode and set its real Team ID. Automatic signing may then create/use the matching profiles; this repository contains no certificate, profile, API key or Team ID:

```sh
cd ios
export IOS_TEAM_ID='YOUR_APPLE_DEVELOPER_TEAM_ID'
./scripts/archive-apps.sh
```

In App Store Connect, create one app record for each bundle ID, choose an available SKU, complete privacy and age-rating disclosures, supply screenshots and review notes, then export each archive. Example for R12:

```sh
xcodebuild -exportArchive \
  -archivePath build/archives/R12.xcarchive \
  -exportOptionsPlist AppStoreConnect/ExportOptions.plist \
  -exportPath build/export/R12
```

Repeat with `R12Club`, `R12Coach` and `GlowZone`. Upload each exported IPA using Xcode Organizer or the App Store Connect Transporter app. App Store Connect API credentials are not required for Organizer/Transporter and must be created and stored by the owner if automation is later desired.

## External release inputs

- Full Xcode and iOS SDK selected in `xcode-select`; this environment currently has only Command Line Tools selected.
- The organisation's Apple Developer Program membership, real Team ID, and account holder/admin access for signing and provisioning.
- Four App Store Connect app records for these bundle IDs, owner-chosen SKUs, listing copy, screenshots, age ratings, privacy labels and review notes. R12 Club and R12 Coach need reviewer credentials with staff/coach access to demonstrate their restricted workflows; do not use customer data.
- A published support contact/URL is not implemented as a dedicated route in the app. The current listing draft uses the app host; replace it with the owner's public support page if needed.
- Review the payment mix by app. Physical gym, Glow Zone and in-person coaching services can use external payment methods when consumed outside the app. Any R12 digital content, functionality, or subscription sold/unlocked in-app must follow Apple's In-App Purchase rules or a storefront-specific approved exception. No payment code was changed here.
- Apple must assess the four distinct listings under minimum-functionality and similar-app rules; acceptance cannot be guaranteed by a local build.

## Local validation

```sh
node ios/scripts/validate.mjs
```

The validator checks project identities, entry routes, scopes, icons, Store Connect draft metadata and absence of signing secrets. Run the Simulator build command after full Xcode is installed.

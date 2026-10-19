# Android Play release plan — deadline 1 November 2026

## Audit and implemented slice

The repository had Next.js PWA routes, one root manifest, one staff Club manifest, cookie-based Supabase auth, safe internal return paths, icons and a static-assets-only service worker. It had no Android/Capacitor/TWA project. Coach and Glow inherited the R12 install identity, and the root manifest incorrectly started at Member Hub.

This change adds four distinct PWA/TWA identities, package IDs, start routes, icons, path-specific deep-link scopes, unsigned/signed AAB commands, an API-36 guard, external signing placeholders and a credential-free Digital Asset Links endpoint. The service worker still never caches documents, APIs or private data.

Glow Zone is not rebuilt. Both `/member-hub/glow-zone` and standalone `/glow-zone` render one shared customer component using existing `club_glow_balance`, history and loyalty actions. Existing staff age verification, sales, row-locked/idempotent deductions and audit records remain unchanged under `/club/sunbeds`. Standalone resolution requires an existing `club_customers.user_id`; it creates no member role, membership, entitlement or door access. Active membership only reveals actual member prices and never grants free minutes.

## Fastest credible path

1. Today: reserve the exact package IDs, confirm account type/date and Android developer verification, obtain legal/store identity details, and start any mandatory closed tests.
2. Deploy to a production-equivalent preview, then production only through the normal release process. Verify all manifests/icons, privacy/deletion URLs, auth redirects and `r12.live` HTTPS.
3. Enrol each app in Play App Signing, return its app-signing SHA-256 fingerprint, configure asset links, and verify fullscreen TWA launch.
4. With JDK/SDK/API 36/Bubblewrap installed, generate AABs, inspect via bundletool and upload to Internal testing.
5. Provide stable reviewer accounts/instructions and complete each app’s listing/App content independently.
6. Submit R12 Club and Glow Zone first (clearest physical-service payments), then Coach, then R12, leaving remediation time.

If this is a personal developer account created after 13 November 2023, every app needs at least 12 continuously opted-in closed testers for 14 days before production access. Starting on 19 October cannot safely guarantee production on 1 November; use 1 November as the testing-track milestone unless Console shows that gate does not apply.

## Device/auth/product test matrix

- All: cold launch, offline/error states, sign-in, sign-up/email verification, password reset, sign-out/relaunch, privacy/deletion, back navigation and no browser chrome.
- R12: training launch/persistence/occurrence identity/progress/WHOOP; no external purchase CTA for paid digital-only fitness.
- Club: member hub, membership/access, classes, physical service purchases, existing Glow entry; never invent entitlement.
- Coach: authorised and denied users, client privacy/roles, valid one-to-one service journeys.
- Glow: Glow-only customer sees the same balance/history as staff; no gym access; member pricing uses actual active membership; staff age verification plus one idempotent deduction appears once in both customer journeys; reconciliation reuses the existing customer.
- Links: only `/training/*`, `/member-hub/*`, `/coach/*`, `/glow-zone/*` map to the corresponding package; shared auth stays same-origin.

Use approved test accounts/fixtures. Never alter live billing/membership, create demo payments or deduct real minutes for review.

## Play policy decisions

- Physical gym memberships, in-person PT and sunbed services remain on existing external payments; Google says Play Billing must not be used for primarily physical services. A live, individual online PT session may also qualify for the 1:1 service exception, but recorded/replay content and digital fitness features/subscriptions do not; those need Play Billing or must be absent from the Play build. [Payments](https://support.google.com/googleplay/android-developer/answer/9858738), [1:1 online services](https://support.google.com/googleplay/android-developer/answer/10281818)
- Four identical wrappers risk rejection. Distinct audience, utility, routes, icons, listings and screenshots are mandatory. [Repetitive content](https://support.google.com/googleplay/android-developer/answer/9899034)
- Complete an accurate Data safety form per app: likely account/contact for all; health/fitness for R12; membership/purchase/attendance/access for Club; coach-client/progress for Coach; identity/DOB/age verification/purchases/activity for Glow. Audit production logging/vendors/retention before submitting. [User Data](https://support.google.com/googleplay/android-developer/answer/18258653)
- Account creation requires in-app and public deletion request paths. `/account/delete` supplies both; an operational SLA and retention schedule still need ownership. [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)
- All apps require the Health apps declaration. R12/Coach should declare Activity and Fitness and any actually launched Nutrition/Weight Management. Add the prescribed non-medical-device/store disclaimer. [Health declaration](https://support.google.com/googleplay/android-developer/answer/14738291), [Health policy](https://support.google.com/googleplay/android-developer/answer/16679511)
- New phone/tablet apps after 31 August 2026 must target API 36. [Target API](https://developer.android.com/google/play/requirements/target-sdk)
- Supply working credentials/instructions for every restricted role/location. [Review access](https://support.google.com/googleplay/android-developer/answer/9859455)

## Exact Play Console/account-owner inputs

- Organisation vs Personal account, creation date, completed identity verification.
- Reserve the four exact package IDs; confirm none was previously installed off-Play.
- Create four free apps (English UK), choose accurate categories/countries and accept Play App Signing.
- Provide four public app-signing SHA-256 fingerprints; securely create/store four upload keys outside Git.
- Provide verified legal developer name/address/contact, final privacy/support email/site/phone, and make listing/privacy identities consistent.
- Provide durable review accounts: training member, Club member with/without Glow credit, Coach, and Glow-only adult; include any OTP/location instructions.
- Approve store copy, 1024×500 feature graphics, current phone screenshots and the included Coach/Glow icon candidates.
- Complete per app: App access, Ads, Content rating, adult Target audience, Data safety, deletion URL `https://r12.live/account/delete`, privacy URL `https://r12.live/privacy`, Health declaration and payments statements.
- Confirm closed-test eligibility and supply tester Google Group/list.

## Genuine blockers

- This environment has no usable Java, Gradle, Android SDK, adb or bundletool, so no APK/AAB/install test was possible.
- The R12 Android experience must not expose external Stripe checkout for paid digital-only fitness features. Before R12 submission, either provide a Play Billing compliant path or exclude those purchase/access surfaces from the Android experience; physical club, PT and Glow Zone purchases can remain on their existing eligible paths.
- No signing keys/fingerprints were available; none were invented.
- `r12.live` was unreachable from available verification tools, so deployed TWA/auth verification is outstanding.
- The privacy contact remains marked as a development placeholder and the legal developer identity is unknown.
- Account deletion needs an operational owner/SLA and legally reviewed retention schedule.
- Feature graphics/screenshots and final icon approval are missing.

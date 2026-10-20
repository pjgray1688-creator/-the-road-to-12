# App Review readiness — 20 October 2026

## Material review risks

- **Guideline 4.2 — high risk across all four:** each app still loads the remote Next.js product inside a WKWebView. Separate SwiftUI shells, scoped tabs, app-specific identity, native back/reload/share and loading recovery improve navigation, but do not create enough native functionality to make a thin client safe under Apple's minimum-functionality guidance. Apple explicitly calls out thin clients for cloud-based apps. The best small native addition here is the Club floor workflow: direct access to daily checks and member inductions, using one-tap checklist updates and the existing server audit trail. That still does not guarantee 4.2 approval. A meaningful native workflow for Training, Coach and Glow Zone is also needed if Apple rejects the web-first experience.
- **Guideline 4.3 — material risk:** four apps share the same product/backend and shell. Listings and reviewer journeys now describe distinct users and workflows. Public Club (staff-only) and Glow Zone (single Carlton service location) are especially hard to justify as broadly useful public apps. See distribution recommendation below. Private distribution does not exempt an app from App Review or 4.2.
- **Guideline 3.1 — product classification must be confirmed:** gym access, tanning sessions and coaching services consumed in person can use external payment methods as physical services. If any app sells or unlocks digital content/features/subscriptions consumed in the app, Apple's In-App Purchase rule applies unless an eligible storefront exception is configured. The shells do not add payment code; do not route digital purchases through external checkout without resolving this classification.
- **Account deletion — submission blocker:** the shared account screen now allows a signed-in user to reauthenticate and submit a deletion request in-app. Requests are stored without deleting identity or business records. An allowlisted operator queue now records review, response and completion attestations; a user can see the current status in-app. It does not erase identity or business records automatically. Before review, configure and verify the responsible privacy operator and the approved manual retention/deletion steps, including how the completed confirmation is communicated if sign-in is removed.
- **Support contact — submission blocker:** `lib/legal.ts` still labels `pjgray1688@gmail.com` a development-safe placeholder. Replace it with the owner's monitored support/privacy contact and publish it in the app and listing.

## Club distribution choice

R12 Club is an employee/franchise staff operations tool. Prefer **Private Custom App** if the receiving Madhouse/franchise organizations have Apple Business Manager and can provide their Organization IDs. Use **Unlisted App Distribution** if intended staff cannot receive a managed custom app; the link is not access control, so retain sign-in, organisation selection and server permissions. Use Public distribution only if there is a real broad market beyond the named gym staff. Apple distribution type is selected per app record and should be settled before creating the record. The same logic may favor unlisted distribution for R12 Coach if it is limited to a closed coach cohort. Glow Zone's limited Carlton audience has a 4.3 risk; consider unlisted access or folding the feature into the broader R12 app.

## Submission materials

- Draft listing copy and distinct reviewer walkthroughs: `apps.json`, `ReviewerWalkthroughs.md`.
- Required iPhone and iPad screenshot sequences: `ScreenshotPlan.md`.
- Draft per-app privacy categories requiring owner/vendor verification: `PrivacyInventory.md`.
- Reviewer notes template: `ReviewNotes.template.md`.
- Xcode Cloud setup and signing guidance: `../XcodeCloud/README.md`.

## Remaining owner inputs

1. App Store Connect app records, SKUs, distribution method, age ratings, pricing/availability, approved marketing/support URLs and reviewed listing copy.
2. Real Apple Developer Program Team membership/Team ID, Xcode Cloud access and reviewer accounts with least-privilege synthetic data.
3. Configure the authorised privacy operator, verify manual retention-aware fulfilment and completion communication, and provide a verified user-facing support contact.
4. Final privacy labels, retention disclosures and digital-vs-physical payment classification.
5. Native functionality sufficient for Apple's review, then screenshots from the final binary and App Review.

Apple references: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy), [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [private/unlisted distribution](https://developer.apple.com/support/unlisted-app-distribution/), [distribution methods](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods).

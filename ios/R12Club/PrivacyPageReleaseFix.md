# Club public privacy-page fix — 24 October 2026

Branch: `fix/r12-club-public-privacy`, worktree `/private/tmp/r12-club-public-privacy`, based on Club preparation `fcc297ef6d95636315c49653069de724f188a20b`. This is a local, unpushed change. No production deployment, settings, provider, database or App Store Connect changes. No iOS source/configuration changes or native rebuilds; the prepared Club archive is untouched.

## Public-facing policy

The URL remains `https://app.r12.live/club/privacy`. A dedicated `ClubPrivacyPolicy` replaces the legacy shared notice for this route only. Main R12 `/privacy`, public `/support`, terms and other apps' notices are unchanged.

The notice identifies R12 Digital Ltd's platform/account/support service and distinguishes gym/employer/coach service decisions without claiming an executed processor/joint-controller contract. It uses the established owner-approved monitored contact `peter@r12.live` and links to Support, Terms, R12 privacy information and the deletion request page. No postal address or company registration details are invented.

Coverage includes staff/customer contact and identity fields, joining address/DOB/emergency details, memberships and attendance, inductions/checks, financial and operational audit records, optional staff photos, support and technical information. It also explains the personal training/progress/WHOOP flows reachable from shared Account. It describes Supabase, Vercel, email and relevant configured payment flows without asserting provider agreements, geographic safeguards or live enablement of every payment adapter. No ad functionality or new diagnostic uploader was added.

Deletion copy matches `/account/delete`: sign-in, password reauthentication, DELETE confirmation, a request recorded for review, account active during processing, status/outcome visibility, existing one-calendar-month response commitment with lawful extension explanation, and separate membership/payment cancellation. It does not claim automatic erasure, immediate removal of backups, a retention period or guaranteed deletion. Retention is expressed through purpose and applicable exceptions.

No new Article 6/9 legal ground or consent process is asserted. Actual legal grounds, provider agreements/transfers, retention schedule and deletion fulfilment remain owner/legal/operational facts; changing the notice does not establish compliance. These questions remain in the internal matrix/handoff, not as customer-facing repository/launch placeholders.

## Public access fix

The old route had two independent problems: the reviewer routing helper sent `/club/privacy` to the restricted synthetic screen, and an existing station cookie could trigger `/club/lock`. Its Club operational layout also queried authenticated account/context data even for the public notice.

The URL now maps to `app/(public-club)/club/privacy/page.tsx`, outside the operational `app/club/layout.tsx`. It renders without Supabase, cookies, account lookup, identity controls or station timeout components. The root site layout and legal-page styling are retained.

Only exact `/club/privacy` **GET/HEAD** requests bypass reviewer/station redirects in the proxy. The reviewer's writes and Club APIs remain denied; normal operational routes retain existing station/reviewer rules. Requests for nested/similar/API paths do not qualify. The helper's public-policy result matches the proxy. No member/staff capabilities or authentication settings were changed.

## Live baseline inspection

Unauthenticated production GETs on 24 October showed:
- `/club/privacy`: HTTP 200, but still the old internal text, missing approved email and outdated no-deletion-route statement.
- `/privacy` and `/support`: HTTP 200, approved contact present, none of those stale statements.

The corrected Club page is **not live** because push/deployment are prohibited. Local verification of the new production build is reported below. A later authorised deployment must verify the public URL again; this task cannot claim the production page has been corrected.

## Exact App Store Connect changes

See the appended step-by-step Club-only checklist in `AppPrivacyCorrections.md`. Keep the substantiated twelve-category selections except that Crash/Performance remain dependent on actual provider collection confirmation; no unconditional deletion of those declarations is justified by source alone. Add Health and Customer Support for current reachable flows. Apply App Functionality and user linkage to identified records; Product Personalization applies to actual tailored-training inputs, not every Club field. Product Interaction audit records do not automatically justify Analytics. Diagnostics/payment/avatar/tracking questions remain conditional; no App Store Connect edits were made.

## Release and submission gates

1. Owner review/approval of customer wording and unresolved legal/operational facts; no provider or retention assurances are inferred from this patch.
2. Separately authorised web integration/push/deployment of the privacy fix. Compare its single-commit diff; do not accidentally deploy unrelated changes or assume Club native preparation has been uploaded.
3. Verify unauthenticated production `/club/privacy`, contact/links and reviewer/station-cookie access after that deployment.
4. Existing independent Club gates remain: obtain provisioning profile, create/validate a signed Club archive, fresh reviewer login and iPhone/iPad walkthrough, final screenshots/privacy/export answers. The unsigned archive from preparation is not upload-ready and was not modified here.

## Completed validation

- Focused policy/deletion/reviewer tests: **20 passed**, 0 failed.
- Actual `npm test`: **1,341 passed, 1 skipped, 0 failed** (1,342 total); skipped fixture requires a disposable migrated PostgreSQL database. No production database tests.
- `npm run build`: **passed**, including TypeScript and static generation. `/club/privacy` is marked static in build output.
- `npm run lint`: **passed**, 0 errors and the same 3 pre-existing warnings in coach-account-actions, exercise-guide-sheet and training-app.
- Local production server/browser: anonymous GET and HEAD **200**; synthetic local reviewer plus station-cookie GET and HEAD **200**, still on `/club/privacy`, no sign-in/demo/lock redirect. No Supabase/account lookup is needed by this route.
- Mobile viewport 390px: document width 390px, no horizontal overflow, no browser page errors; contact and response wording checked. Desktop visual capture also completed. All cookie fixtures were local-only test inputs, never sent to production or an authentication provider.
- Tests prove operational station locks, reviewer operational rewrites, Club API denial and reviewer POST denial still apply; similarly named/nested routes do not get the exception.
- `git diff --check`: **passed**. Main R12 notice/support, shared policy component, API routes, all iOS source/configuration and prepared archive were not changed. No native build was run.

Logs: `/private/tmp/r12-club-privacy-focused.log`, `r12-club-privacy-full-tests.log`, `r12-club-privacy-build.log`, `r12-club-privacy-lint.log`. Browser captures: `/private/tmp/r12-club-privacy-mobile.png`, `/private/tmp/r12-club-privacy-desktop.png`.

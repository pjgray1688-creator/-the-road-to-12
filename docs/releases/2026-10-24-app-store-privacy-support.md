# R12 App Store privacy/support release fix — 24 October 2026

## Scope and release gate

Branch: `fix/r12-app-store-privacy-support`. Base: deployed production `c7f94ba1e256df804ddcec0e099dd9fefaab048a`, confirmed through Vercel deployment metadata on 24 October. No native changes; uploaded 1.0.0 (1) is untouched. No account, permission, payment, provider, database or environment changes. No merge, push or deployment.

Owner confirmed `peter@r12.live` is monitored and approved in this session. This replaces the old unapproved Gmail placeholder. No postal address, registration number, data residency or contractual assurance has been invented.

Proposed public URLs after approved deployment:
- Privacy: https://app.r12.live/privacy
- Support: https://app.r12.live/support
- Deletion information/request: https://app.r12.live/account/delete

The full proposed customer policy is `components/r12-privacy-policy.tsx`; support copy is `app/support/page.tsx`. Existing Club, Coach and Glow notices remain separate and are not certified by this R12-only change.

## Processing evidence and Apple reconciliation

The ten selected categories are not a complete answer. Evaluate data transmitted off device and retained, including service providers, across routes reachable through the submitted app. Do not include staff-only or future functionality merely because its types exist in the repository.

| Apple data type | Evidence / recommendation | Purpose | Linked / tracking |
| --- | --- | --- | --- |
| Name | Keep: account/profile and gym joining | App Functionality | Linked; no tracking feature found |
| Email Address | Keep: Supabase identity, joining and support | App Functionality | Linked; no tracking feature found |
| Phone Number | Keep if reachable gym joining/customer services collect it; not required for basic R12 login | App Functionality | Linked when collected; no tracking feature found |
| Physical Address | Keep if reachable gym joining is available: address lines/town/postcode are collected | App Functionality | Linked when collected; no tracking feature found |
| Health | Keep: body metrics and optional WHOOP recovery/sleep/HRV/resting heart rate | App Functionality; Product Personalization for recovery-based training | Linked; no tracking feature found |
| Fitness | Keep: training profile, programmes, workouts, exercise/cardio records | App Functionality; Product Personalization for tailored training | Linked; no tracking feature found |
| Photos or Videos | Progress upload is explicitly unavailable (`lib/progress.ts`). Remove if no other reachable collection/provider flow exists. Support screenshots may still be received by email; assess against Apple's optional-disclosure criteria rather than assume exemption | App Functionality if collected | Linked when sent with support identity; no tracking feature found |
| Customer Support | Keep: support correspondence and account-deletion request/response records | App Functionality | Linked; no tracking feature found |
| Other User Content | Keep: workout notes, feedback, preferences and coaching content where available | App Functionality; Product Personalization where used in tailored training | Linked; no tracking feature found |
| Purchase History | Keep for reachable member purchases/membership transactions: amount/status/order/provider references | App Functionality | Linked; no tracking feature found |
| **User ID — missing** | **Add**: Supabase user ID, profile/workout ownership and customer/account references | App Functionality | **Linked**; no tracking feature found |
| Other Diagnostic Data | Provider/security/error logging needs deployed retention and field verification before final answer | App Functionality for security/fault resolution; Analytics only if actually used to evaluate behaviour | Linkage depends on actual fields; unverified |
| Crash Data / Performance Data / Product Interaction | No dedicated analytics/crash SDK found in package.json, layout or native shell inspection. Verify enabled hosting dashboards, log drains and provider collection before selecting/omitting | Match actual enabled use | Unverified at provider level |
| Device ID | No advertising ID, push-token registration or member-device identifier collection found. Session/user IDs are not automatically device IDs. Club door-controller device IDs are separate hardware, not proof of R12 member-device collection | Do not add solely for session cookies | Unverified provider behaviour |
| Payment Info / Other Financial Info | Review actual hosted payment boundary and retained fields. External card entry alone does not justify Payment Info; account purchase history does not itself establish Other Financial Info. Stored-value balances and mandate/bank-account references in reachable gym flows require separate review | App Functionality if collected | Linked if retained |

No advertising or cross-company advertising tracking implementation was found in inspected source. This does not certify vendor configuration or authorise an unconditional “No Tracking” assertion. Ordinary account linkage is not Apple's tracking definition. No marketing or third-party-advertising purpose was established. Training tailored to health/fitness inputs should include Product Personalization rather than App Functionality alone.

Sources: Apple's current definitions and collection/optional-disclosure rules: https://developer.apple.com/app-store/app-privacy-details/ . Rights response guidance: https://ico.org.uk/for-the-public/time-limits-for-responding-to-data-protection-rights-requests/ . Provider settings and retained logs were not accessed; no secrets were read.

## Source evidence

- `components/club-joining-form.tsx`: name, email, mobile, address, DOB and emergency contact; these are optional gym services relative to basic R12 account use, not optional fields inside that form.
- `app/api/training-profile/route.ts`, `app/api/training-state/route.ts`, `app/api/workouts/`, `lib/workout-sync.ts`, `lib/types.ts`: account-scoped profile/state/workout persistence, notes and workout import.
- `lib/progress.ts`: body measurements; progress-photo availability false. A photo type alone is not off-device collection.
- `lib/whoop-server.ts`: OAuth recovery/sleep/cycles/workout scopes; encrypted token persistence, normalized recovery/HRV/resting heart rate/sleep-performance/strain records. Disconnect removes connection tokens; imported records are not erased by disconnect.
- `lib/stripe-join-provider.ts`, `lib/stripe-commerce-provider.ts`, gym payment completion routes: hosted payment flows and retained provider references. No payment tests performed.
- `lib/notification-provider.ts`, `lib/smtp-config.ts`: email provider depends on configuration; Supabase Auth email is separate. Do not assert a named SMTP vendor without confirmation.
- `app/layout.tsx`, `package.json`, native shell source: no dedicated advertising/analytics SDK found. Native files were inspected only.

Existing Google Play material was reused for accurate app-specific data descriptions, provider identities, WHOOP behaviour and synthetic review boundaries. It was not treated as approved legal bases or proof of deployed settings. `PrivacyInventory.md` remains a draft; its blanket suggestion about Sensitive Info for age alone should not be followed: DOB is not automatically Apple's Sensitive Info category.

## Deletion workflow

`/account/delete` requires sign-in, current password and DELETE confirmation. The same-origin API verifies the password and records a request through a service-role RPC. It returns 202; it does not erase Auth or business records. Status is visible to the account holder. An authorised privacy operator can review the queue and record an outcome, with retention/eligible-data processing attestations required before completion. Marking completion does not itself run an erasure engine; the operator must actually carry out the eligible deletion/anonymisation separately.

The policy matches the existing one-calendar-month response commitment and lawful-extension explanation. A deletion request does not cancel memberships, Direct Debits or subscriptions. Relevant financial, dispute, safety and audit exceptions are described as criteria, without invented retention periods. Email provides an alternative if sign-in/form access fails.

No migration was run and no request submitted. Deployment of the deletion migration, service-role configuration, privacy-operator access and operational fulfilment have not been verified. Owner must confirm a responsible operator monitors requests and can complete actual erasure/anonymisation. Email support must be able to receive and handle these requests.

## Remaining owner facts / approval

1. Approve customer wording and confirm R12's platform-controller responsibilities and gym/coach instruction arrangements reflect actual operations/contracts.
2. Confirm the lawful Article 9 condition and appropriate user information/consent process for health data; WHOOP OAuth alone is not proof. The new copy does not invent an explicit-consent flow.
3. Confirm provider contracts, international transfers/safeguards, operational log collection/retention and backup handling. The notice makes no invented residency or transfer assurance; provide any legally required additional particulars before publication.
4. Confirm deletion migration/operator access and manual fulfilment, retention criteria and actual periods where required. No database changes are authorised by this fix.
5. Confirm submitted R12 web routes for gym joining/purchases, any support attachments, and provider diagnostics before final Apple answers. No App Store Connect changes have been made.
6. Approve deployment of this narrow web patch only after checks and final production-base comparison. Do not deploy the broader release candidate incidentally.

## Safe deployment sequence

Review the diff and outstanding facts, verify production has not moved, then approve the web patch. Commit/push the isolated branch only when authorised. A branch push may trigger a Vercel preview, so preview creation must be intentional. Verify public privacy/support/terms/deletion presentation on that preview without submitting forms. Review the exact production diff, then obtain production deployment approval. After deployment, confirm the public URLs return 200 and show the approved contact, request-only deletion wording and no internal audit language. The owner can then enter the Support URL and reconciled privacy answers in App Store Connect. No native rebuild is required for these hosted page changes.

## Validation

- Focused policy/deletion tests: 9 passed, 0 failed.
- Actual `npm test`: 1,330 passed, 1 skipped, 0 failed (1,331 total). Initial sandbox IPC restriction resolved by running the same command with execution permission.
- `npm run build`: passed, including TypeScript and static generation. Initial shared dependency symlink was replaced with a local dependency copy; no package or lockfile changes.
- `npm run lint`: passed with 3 pre-existing warnings in coach-account-actions, exercise-guide-sheet and training-app; no errors.
- `git diff --check`: passed.
- Generated `/privacy` and `/support` HTML inspected: approved mailto contact and deletion/terms links present; no repository/audit/placeholder wording in customer-visible text. Both routes prerender statically without authentication.
- React review: server components, no new hooks/client bundle, auth calls or writes; semantic headings and normal links use existing legal-page styling.
- No live email, deletion submission, payment, authenticated data mutation, provider configuration change or native rebuild. Mailbox monitoring is owner-confirmed, not test-email verified.

## Integration review addendum

Reviewed all seven files and the full report again on 24 October. Replaced the statement that R12 handles records on an organisation's behalf with a factual software/access description: no executed processor arrangement is established by source. Responsibility wording describes each service provider's decisions and does not certify controller/processor contracts. Added a regression check for this distinction.

Author identity is reliably established by five consecutive production commits (`c7f94ba`, `bf7a71a`, `2c19509`, `93bd74d`, `9990bdd`): Peter Gray, `pjgray1688-creator@users.noreply.github.com`. This existing identity is used in repository-local Git configuration only. Earlier commits sometimes contain a truncated address; that truncated variant is not reused.

Production remains `c7f94ba` at this inspection. A separate integrated branch will start at committed `6134ff2`; the original validated candidate is not rewritten. The original candidate worktree now has owner-local Xcode project/workspace changes, which are preserved, not copied or staged. Integration validation and the current preview gate are recorded in the separate integration report; historical counts above describe the earlier privacy-only checks.

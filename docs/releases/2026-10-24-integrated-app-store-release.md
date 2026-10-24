# Integrated R12 App Store candidate — 24 October 2026

## Exact integration

- Production remains `c7f94ba1e256df804ddcec0e099dd9fefaab048a`, READY deployment `dpl_AghVn8G4cziSGd6gabWFVn62CvjV`, resolved from `app.r12.live` through Vercel. It has not advanced since the prior audit. This is the deployed production commit, not a claim about GitHub main or automatic production branch settings.
- Privacy/support commit: `8eb23dd84354d55649261ac73b897132d0404316` on `fix/r12-app-store-privacy-support`.
- Existing validated candidate: `6134ff2f7f727ea5f50029c2dae7f9466f395758` on `integration/r12-ios-release-candidate`.
- Integration merge: `aa390a256f41f81da845a7e41a75fb695facb200`, on `integration/r12-ios-privacy-release-candidate`, worktree `/private/tmp/r12-ios-privacy-release-candidate`.
- This report is committed after the merge; that subsequent commit changes documentation only.

The seven privacy/support paths have zero path overlap with the 31 changed paths in the validated candidate. A normal non-fast-forward merge into the new branch preserves both exact histories; no cherry-pick duplication, conflict resolution or history rewrite was necessary. Each of the 38 changed paths was compared by Git blob ID with its source branch and matched. Both original tips are ancestors. All current production Club and security changes remain ancestors. No original branch was moved.

The committed iOS tree is byte-for-byte identical to `6134ff2`. Native navigation, launch branding and minimal header are retained as source; password controls, login/Home recovery and the 17 shared web changes are preserved. No native build, archive, upload or binary change occurred. The original validated candidate worktree now contains local Xcode project/workspace changes; those were not copied, staged or altered. Original repository Xcode changes are also preserved.

## Privacy/support review

All seven files and the complete privacy release report were inspected. The owner confirms `peter@r12.live` is working, monitored and approved. `/privacy` uses the dedicated customer-facing R12 notice; `/support` is public and links to privacy, terms and deletion information. Other apps' separate policy notices remain outside this patch and are not certified for submission.

The initial sentence claiming that R12 handles organisation records on its behalf was replaced before committing. The notice now describes R12's platform service, the gym/coach's own service decisions, and permission-controlled sharing without certifying an executed processor or joint-controller arrangement. Legal review of the actual roles and agreements remains necessary; source alone cannot establish them.

`/account/delete` requires the signed-in account, current password and DELETE confirmation. The same-origin API reauthenticates and records a private request with HTTP 202. It does not delete Auth, training or business data. Status and the operator response can be read by the account holder. The queue requires a user in `R12_PRIVACY_OPERATOR_USER_IDS`, with password reauthentication and explicit completion attestations. Marking a request complete does not execute erasure: eligible-data deletion/anonymisation must actually be carried out separately. These endpoints and their underlying migration are unchanged by this release.

The policy accurately states request review, the active account during processing, a response within one calendar month, explanation of a lawful extension, retention exceptions and separate membership/subscription cancellation. Source verification is not a live request test: migration deployment, operator configuration and the real fulfilment procedure remain unverified.

## Focused Apple correction matrix

Based on https://developer.apple.com/app-store/app-privacy-details/ checked 24 October 2026. These are proposed owner answers, not changes to App Store Connect. Collection means information transmitted off device and retained beyond servicing the immediate request, including partners. User linkage and advertising tracking are separate questions.

| Category / purpose | Exact correction | Linkage / tracking |
| --- | --- | --- |
| **User ID** | **Add**; Supabase identity and account/customer/workout ownership. Purpose: App Functionality. | Linked to user. No tracking implementation found; confirm partners before final tracking answer. |
| **Product Personalization** | This is a purpose, not a data category. Add to Health and Fitness where their inputs tailor recovery/training suggestions; also Other User Content where entered goals/preferences/notes actually drive tailoring. Retain App Functionality. | Account-linked inputs. No advertising purpose found. Do not apply to all categories indiscriminately. |
| **Photos or Videos** | Private progress uploads are disabled. Remove if there is no other reachable retained photo/video collection. Email support screenshots are possible; evaluate Apple's full optional-disclosure criteria before treating them as exempt. | Linked if sent with identified support correspondence. Final yes/no depends on actual flow. |
| **Other Diagnostic Data** | Confirm retained error/security logs, fields, provider access and purpose. Add if collection meets Apple's definition. Do not assume hosting alone establishes the correct subtype. | Identity linkage depends on retained identifiers; unverified. App Functionality for security/support; Analytics only where actually used for that purpose. |
| **Crash Data / Performance Data / Product Interaction** | No dedicated SDK found in inspected source. Confirm enabled Vercel/Supabase monitoring/log drains and any third-party collection before omitting or adding. | Provider configuration unverified. |
| Name / Email | Keep, App Functionality. | Linked. |
| Phone / Physical Address | Keep where reachable gym joining/customer flows collect them. Basic R12 password login does not require them. | Linked when collected. |
| Health / Fitness | Keep, App Functionality plus applicable Product Personalization above. Optional WHOOP collection still counts when used. | Linked. |
| Customer Support / Other User Content | Keep for support/deletion requests and training notes/feedback. App Functionality, with applicable personalization above. | Linked. |
| Purchase History | Keep for reachable membership/purchase records. App Functionality. | Linked. |
| Device ID / Payment Info / Other Financial Info | Do not add merely because sessions or hosted checkout exist. Confirm actual retained device IDs, payment fields and monetary stored-value/mandate information in reachable flows against Apple's definitions. | Linked if retained against account; provider details unresolved. |

No advertising SDK or cross-company advertising tracking feature was found in inspected source. This is not a guarantee about deployed vendor configuration. “No Tracking” requires the owner's confirmation across partners. No advertising/marketing purpose was established. The full ten-category inventory and processing evidence remain in `2026-10-24-app-store-privacy-support.md`.

## Unresolved owner decisions — production gate remains closed

1. Confirm actual controller/processor responsibilities and gym/coach contracts; approve the proposed customer wording and purpose/basis explanations.
2. Identify the valid health-data Article 9 condition and corresponding user information/consent process. WHOOP OAuth is not proof of all legal requirements. No consent mechanism has been added or claimed.
3. Confirm active providers, agreements, international handling and required safeguards, diagnostics, retention schedule and backup deletion behaviour. No residency or contractual assurances are invented in the notice.
4. Confirm deletion migration and privacy-operator setup, queue monitoring, actual erasure/anonymisation procedure and how retained records/outcomes are communicated. The one-month response commitment requires real operational ownership.
5. Confirm reachable gym/payment and support-attachment flows, then finalise App Privacy answers. No App Store Connect edits occurred.
6. Verify the existing reviewer account and populated training journey; prior code fixtures do not prove account access. Validate shared-web changes against uploaded 1.0.0 (1), not a rebuilt binary.

## Protected preview gate

**Source ready for a protected, unauthenticated rendering preview after owner approval; not production-ready or validated for authenticated production-backed testing.**

Vercel project `prj_cOkcINMIEn7vv0MOpOvhYffWj4uP` reports SSO protection enabled with deployment type `all_except_custom_domains`. The new branch filter returns zero matching environment records. A future deployment's exact protection and environment must still be inspected; do not attach a public custom domain or assume protection from a READY status. No deployment was created.

Static privacy/support pages need no backend credentials. Do not automatically copy production secrets to make a preview functional. Shared production Supabase can be considered separately with owner-approved configuration, but user credentials permit real writes and Home can import cached workouts. Vercel protection controls access; it does not isolate data. Live Stripe, email, workers, webhooks and WHOOP must not be exercised merely because the preview is protected. No environment or provider settings changed.

After explicit push/preview approval: publish only this integrated branch, verify the exact deployment SHA and protection, then inspect privacy/support/terms/deletion presentation without submitting forms. Do not infer Git production mappings or push main. Authenticated sign-in, password visibility/reset presentation, Home retry and shared Club/Coach/Glow behaviour need controlled tests with approved account/data access. Native host restrictions mean a preview URL alone cannot prove the uploaded binary's full production web integration. Re-resolve production and review its diff before any later production approval. No production promotion is authorised by this report.

## Integrated validation results

- Focused privacy, deletion and iOS-shell tests: **14 passed, 0 failed**.
- Actual `npm test`: **1,335 passed, 1 skipped, 0 failed** (1,336 total). No production database tests were run.
- `npm run build`: **passed**, including TypeScript and static generation.
- `npm run lint`: **passed**, 0 errors and the same 3 pre-existing warnings: internal window navigation in coach-account-actions and img usage in exercise-guide-sheet/training-app.
- `node ios/scripts/validate.mjs`: **passed**; this is source validation, not a native rebuild.
- `git diff --check`: **passed**.
- Generated privacy/support HTML: approved mailto address, deletion/terms links, one-month response commitment and customer-facing wording verified. No browser/device or live backend correctness is inferred from prerendering.
- Git blob checks: all 38 inherited changed paths exactly match their originating branch; both original tips and all five later Club commits plus security base are ancestors. Native tree matches committed `6134ff2`.
- No live payment, account/deletion submission, email, migration, configuration change, push, deployment, native build or Apple upload performed.

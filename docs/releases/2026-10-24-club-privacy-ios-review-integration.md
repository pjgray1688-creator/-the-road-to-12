# Club privacy and iOS review integration

This report supersedes the web-only scope of 2026-10-24-club-privacy-production-integration.md and updates FinalReviewPolish.md's branch/deployment instructions. No production release or Apple upload is authorised in this task.

## Verified baseline and integration

Live `app.r12.live` resolves through Vercel to READY production deployment `dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf`, commit `ff8ec5f02727419991e3a4b8340ecb5432c48f64`. The anonymous live Club privacy page returns 200 but still lacks peter@r12.live and contains the old repository/deletion-placeholder wording: the privacy correction has NOT been deployed.

Remote main is `31eb5e05ed999beffdbb3f5448407b92c53f73de`, an ancestor of the live release (70 commits behind), not a newer production baseline. Existing dirty main R12 project/workspace and owner Club preparation signing settings remain untouched in their original worktrees.

Isolated branch: `integration/r12-club-privacy-ios-review`.
Worktree: `/private/tmp/r12-club-privacy-ios-review`.
Parent base: `1ac373f629a1696276e676b49c9ab7706d990a72`, which already includes the privacy patch on the exact live baseline. No duplicate privacy cherry-pick. Applied only the missing Club native preparation `fcc297e` as `ae9f9b8` and polish `1183215` as `c0755e9`. One documentation-only add/add conflict in AppPrivacyCorrections.md was resolved by preserving the newer matrix already present in 1ac373f. All app/component/lib/native/test/proxy content is byte-identical to reviewed polish 1183215; only release documentation differs. All live production commits are ancestors of this integration.

Main R12, Coach, Glow Zone and shared native sources, API endpoints, database migrations, Stripe/provider configuration, dependencies, environment examples and cron configuration are unchanged from live production. Club's public GET/HEAD privacy exemption is exact-path only. Station restrictions, reviewer entitlement/rewrites/API/write denial and server capability boundaries are retained. Shared Club presentation changes affect only intended Club menu/shop/register cases, with consumer demo presentation retained.

Club native tabs: Reception / Daily Checks / Members / Shop / More. The existing persistent shell's selected tab follows actual web history. Members reuse the production directory and synthetic reviewer profiles; reviewer shop has three products, prices/images and synthetic stock. Menu and More use the same role-filtered component; Finance/management links stay manager-only and server permissions remain authoritative. Staff & PT schedule is retained independently from Classes. Glow Zone and Inductions stay in More. No QR work. Reviewer labels are App Review Demo and DEMO ACCOUNT - READ ONLY.

## Preview and validation

Use the exact final commit reported by Git and the final handoff. Push only this integration ref, without force; preserve all other refs. Preview belongs to project `prj_cOkcINMIEn7vv0MOpOvhYffWj4uP`, team `team_6WTX0aq6dKQHqDT97nitjoyU` / `peter-gray`. Existing Vercel SSO is enabled for all_except_custom_domains. Do not disable protection or create share/bypass access to work around an unavailable authorised session. READY/build success alone is not functional verification. Preview backend isolation is not established; do not submit forms, execute financial operations or make authenticated writes.

Final validation results and the actual preview URL are recorded in the task handoff. Logs are `/private/tmp/r12-club-integration-{focused,tests,build,typescript,lint,browser,ios}.log`. Browser harness uses real components and synthetic fixtures with throwing server-action sentinels; it is not a live-provider test. Simulator tests use only an existing confirmed reviewer session; native tests exercise current hosted production UI, while new web UI is checked locally until deployed.

## Exact future production procedure — separate approval required

1. Obtain approval for this integration's exact final SHA. Recheck `app.r12.live` deployment and SHA and stop on divergence from ff8ec5f until the new production commits are integrated and validated. Verify the approved remote ref, clean worktree and validation record. Do not merge an older baseline over newer production.
2. Preserve rollback deployment `dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf` (READY, target production, currently marked rollback candidate), `https://the-road-to-12-hiavr9bmj-peter-gray.vercel.app`, commit ff8ec5f. Reconfirm eligibility immediately before release. Capture the then-current production environment metadata privately; do not print/copy values or change settings.
3. Create a NEW production-targeted deployment with the existing project configuration, pinned to the approved commit. Do not alias/promote the protected Preview. Connected Vercel create_deployment request:

```json
{
  "teamId": "team_6WTX0aq6dKQHqDT97nitjoyU",
  "requestBody": {
    "name": "the-road-to-12",
    "project": "prj_cOkcINMIEn7vv0MOpOvhYffWj4uP",
    "target": "production",
    "gitSource": {
      "type": "github",
      "repoId": "1351450196",
      "ref": "integration/r12-club-privacy-ios-review",
      "sha": "EXACT_APPROVED_FINAL_COMMIT_FROM_HANDOFF"
    }
  }
}
```

No files, environment/project overrides, Preview deployment ID or custom environment. Existing production Supabase/Stripe/WHOOP/email/webhook configuration must be preserved. No migration or provider change is required.

4. Inspect deployment until READY; confirm exact SHA/production target and app.r12.live alias. Check anonymous GET/HEAD /club/privacy with monitored mailto contact, request-only deletion wording and links to /support, /privacy, /terms and /account/delete. Check mobile/desktop overflow and browser errors. Confirm /privacy and /support unchanged. Signed-out /club, /club/reception, /club/checks, /club/members, /club/shop and /club/more must retain their existing auth/reviewer/station boundaries. Use existing authorised reviewer access to inspect synthetic Members/Shop/Menu; no actual payments, member edits, deletion requests, access operations or submissions. Ordinary staff/manager read-only navigation checks require their authorised sessions; source tests are not live permission certification.
5. If essential policy/routing/protection checks fail, call Vercel request_rollback with teamId team_6WTX0aq6dKQHqDT97nitjoyU, projectId prj_cOkcINMIEn7vv0MOpOvhYffWj4uP, deploymentId dpl_HPR3fYnPDYzorqtoGGfUM5npX9Lf and a failure description. Verify READY mapping and smoke-test restored routes. Do not roll back data/providers or Apple binaries. Rollback may disable automatic production alias assignment; inspect release state before later releases. If the baseline changes, use the freshly captured and validated production rollback target instead.
6. A web deployment cannot change the native tabs of an already built app. Build a NEW Club Release using this branch's Club project, preserving bundle live.r12.club, 1.0.0/build 1 (confirm build number availability), team79ZP9U47SK and owner's existing Manual distribution profile. Repeat actual reviewer walkthrough after web deployment, capture real iPhone/iPad screenshots, archive and validate. No prepared archive is overwritten and no Apple upload is performed by this task.

## Outstanding external decisions

Existing AppPrivacyCorrections.md remains authoritative for unresolved provider diagnostics/crash/performance collection, payment fields, photos/support attachments, tracking, health-data legal grounds, provider responsibilities/transfers, retention and deletion-request fulfilment. Do not convert this technical integration into compliance assurance. Final screenshots, signed archive validation, correct Apple privacy answers and owner upload/submission remain separate gates.

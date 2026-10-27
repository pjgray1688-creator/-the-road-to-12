# App Review walkthroughs

Create separate, synthetic App Review accounts. No credentials belong in this repository. Keep the staging data isolated from members and customers.

## R12 — member training

1. Sign in with the supplied test member account.
2. Open **Training** and show the assigned plan and session workflow.
3. Open **Progress** and show synthetic training history, a personal best and progress entries.
4. Open **Account** to show the shared account controls and privacy links.

The reviewer account must have a valid R12 login and representative assigned training data. Explain any feature that is unavailable without a connected wearable or membership entitlement.

## R12 Club — mobile staff operations

1. Enter through **Reception** (`/club/reception` redirects to the authenticated `/club/access` workflow). Sign in with the supplied staff account and select the authorised organisation/location.
2. Open **Daily checks** from the native tab bar. Mark one synthetic venue checklist item complete, switch screens, return and confirm its persisted checked state and staff attribution. Show equipment checks, open fault reporting and the manager issue overview where the account permits it.
3. Search for the synthetic member **R12 Review Member**. Open the existing induction booking, read each required published stage with the member, save stages individually, switch away and return to confirm progress persists, then record final completion only after all required stages are saved. Show the member's resulting induction/access state. Optional information sections do not gate completion.
4. Open **Account** to show account and privacy controls. Open **Delete your R12 account**, show the reauthentication and typed confirmation requirement without submitting a real deletion request; explain that deletion can affect all connected R12 applications, while any linked membership, recurring payment agreement or other service requires separate cancellation.

Use an account with `staff.work_submit`, venue access and `induction.perform`; use a separate manager account only if demonstrating review, checklist reopening or issue escalation. Keep all member details synthetic. Never use the live member import or real customer records for review.

## R12 Coach — coach workspace

1. Sign in with the supplied coach-enabled account.
2. Open **Workspace**, select the synthetic client assigned to that coach, and show the relationship-scoped client record.
3. Open **Diary** and **Programmes** to show the coach-specific schedule and programme workflow.
4. Open **Coach account** and **R12 account**.

The reviewer account must have Coach access and at least one synthetic client relationship. Do not grant broad access to real clients.

## Glow Zone — customer balance and activity

1. Sign in with the supplied synthetic, linked Carlton customer account.
2. Show available minutes, next expiry and synthetic activity history.
3. Show the safety guidance and any package information available to that test account.
4. Open **R12 Account** and the privacy page.

Configure this account using the existing age/eligibility and account-linking workflow. Do not represent the test balance as a real purchase or use production customer data. Explain that service purchases/fulfilment are for the physical Carlton service and take place under the existing staff process.

## Reviewer access readiness

Before submission, provide unexpired credentials in App Store Connect review notes, ensure sign-in works without a personal device or one-time code, and keep the review environment available for the review period. Give each app only the access needed for its walkthrough. Verify that demo data is synthetic and resettable. Replace the route details above if the final review build changes.

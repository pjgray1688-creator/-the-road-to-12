# App privacy disclosure inventory — draft for owner verification

This is an evidence-based inventory from the current routes and shell projects, not a final App Privacy answer. Confirm all data collected by the live Next.js host, Supabase, Vercel, Stripe, WHOOP and any other enabled SDK/provider before submitting. Disclose data collected by third parties through the app. A privacy policy URL is already configured, but its published support contact currently contains a development placeholder.

| App | Candidate data categories to review in App Store Connect | Why present |
| --- | --- | --- |
| R12 | Contact Info; Identifiers; Health & Fitness; User Content; Usage Data; Purchases (if account entitlement is visible) | Account, training plans, workout/progress entries, optional wearable recovery data and membership context. |
| R12 Club | Contact Info; Identifiers; User Content; Usage Data; Purchases/Financial Info only if staff finance screens are enabled in the submitted app | Staff identity, member lookups, checklist and equipment records, faults, induction actions and audit attribution. |
| R12 Coach | Contact Info; Identifiers; Health & Fitness; User Content; Usage Data | Coach identity, assigned client relationships, programmes, diary and coaching records. |
| Glow Zone | Contact Info; Identifiers; Purchases; Usage Data; Sensitive Info only if age/eligibility fields are retained or exposed | Linked customer account, minute balance, expiry, visit activity, service-package context and age/eligibility workflow. |

Current evidence suggests account-linked data, so evaluate the categories as **linked to the user**. No advertising SDK or cross-app tracking purpose is present in the native shell source inspected; verify the web app and vendor SDK behavior before declaring **Data Not Collected** or **No Tracking**. Device GPS is not needed for venue selection; staff choose an authorised venue. The privacy policy says raw card/bank details are not stored by R12, but verify the payment provider's collection and disclosure requirements. Do not classify sensitive age data until the exact stored fields and purpose are confirmed.

Owner completion: confirm all processing purposes, retention/deletion behavior, service providers, crash/diagnostic logs, data encryption in transit/at rest, account-linked flags, tracking, and country-specific nutrition/health terminology. The App Store privacy answers must match the final production binary and privacy policy.

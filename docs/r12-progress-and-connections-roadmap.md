# R12 Progress and Connections: product follow-up

This is a planning note only. No screens or provider integrations are implemented by the Home loading hotfix. Any provider capabilities, eligibility, regional availability, scopes, and terms must be rechecked with the provider before implementation.

## Progress screen opportunities

- Lead with a small set of understandable summaries: completed sessions, consistency, and the user's recorded measurements. Keep recovery data visibly separate from training outcomes.
- Add selectable time windows to weight and measurement trends, with clear dates and change from the prior period. Do not infer a trend from a single measurement.
- Show programme completion and recent training volume only when the underlying records are present; provide a useful empty state for new users.
- Distinguish manually entered, imported, and provider-supplied records, including the last successful sync time. Never fill missing values with estimates that look measured.
- Keep charts readable on a phone, label units and date ranges, and provide an accessible text summary for each chart.

## Wearable and activity connections roadmap

Start with a provider-neutral consent and data model. Each connection should be optional, revocable, user-scoped, and clear about which data types it reads. Keep source, timestamp, units, and sync status on imported records. Avoid letting imported recovery metrics silently change a training plan until that behavior is explicitly designed and explained.

| Provider | Potential member value | Planning step |
| --- | --- | --- |
| WHOOP | Recovery, sleep, strain, and workout context | Extend the existing WHOOP connection carefully; review current scopes, token lifecycle, and data freshness. |
| Apple Health / Apple Watch | A user-controlled iPhone health and activity source | Assess an iOS companion path, health permissions, supported data types, and the required user disclosures. |
| Android Health Connect | User-controlled Android health and activity records | Assess Android permissions, supported record types, background-read limits, and Play disclosures. |
| Samsung Health | Samsung device health and activity context | Verify the current partner access route, eligibility, supported platforms, and required permissions before committing to a connector. |
| Garmin | Training activities and selected wellness context | Verify current developer access, approval requirements, scopes, and which records can be read. |
| Oura | Sleep, readiness, and activity context | Verify API access, consent scopes, rate limits, and freshness semantics. |
| Strava | Recorded activity and exercise history | Keep activity import distinct from health or recovery signals; verify API access, scopes, and applicable use restrictions. |

Suggested sequence: define consent, source attribution, deduplication, and disconnect behavior; assess the native health hubs (Apple Health and Health Connect); then prioritize direct provider links based on member demand and verified access (WHOOP, Samsung Health, Garmin, Oura, and Strava). This is a proposal, not a commitment or statement that integrations are currently available.

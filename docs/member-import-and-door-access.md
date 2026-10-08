# Member import and door access runbook

## CSV import

Use `/club/members/import` with an account that has `members.import`. Download the template in the page. Dates must use `YYYY-MM-DD`; recognised membership states are active/current/live/paid/staff/free/manual, inactive/ended/lapsed/expired, and cancelled/canceled/terminated.

Staging is a server-validated dry run. Map each source membership name to an existing R12 membership product, review accepted/conflicted/rejected counts, authorise accepted rows, then execute. Re-uploading the identical file returns the existing checksum-addressed batch. Invalid rows stay rejected and do not prevent accepted rows from importing.

The importer never creates Auth users. A unique verified Auth email can be linked; missing or duplicate emails remain unlinked and claimable. Existing Club roles and Coach records are not changed. Active imported memberships use source `legacy_import`, contain `billing_evidence: not_imported`, and do not create payments, mandates, billing arrangements, or provider events.

Before the real import, Peter must provide the untouched CSV export, confirm source date semantics and status labels, approve each source-package mapping, and resolve reported identity conflicts. Take a dry-run report first and retain it with the approved source file.

## Door/access boundary

Reception uses `/club/reception` (routed to `/club/access`) to scan an imported legacy member reference or find a customer. Decisions are made in the database from current location, membership status/dates, gym-access product entitlement, and the configured billing suspension policy. Every allow/deny is recorded without storing the presented credential.

No physical controller implementation was present in the repository. The optional HTTP bridge is `POST /api/club/access/decision`; it is not an assumption about the door unit itself. A compatible controller or local bridge must send:

- `Authorization: Bearer <device secret>`
- `X-R12-Device-Id`, `X-R12-Request-Nonce`, and ISO `X-R12-Presented-At`
- JSON `{ "credential": "...", "credentialType": "legacy_member_reference" }`

Requests have a two-minute freshness window, nonce replay prevention, a 120/minute device ceiling, location-bound credentials, and an audit row. Device records store only a SHA-256 secret hash. There is intentionally no UI or API that provisions a live device.

Before integration, Peter must provide the controller make/model, its supported credential and integration interfaces, network topology, expected unlock command/acknowledgement behaviour, timeout/fail-secure policy, and per-door location mapping. A reviewed device row and secret must then be provisioned out of band; do not place either in source control.

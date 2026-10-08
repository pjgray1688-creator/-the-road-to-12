# Madhouse member PIN and QR access pass

## Credential model

Each Madhouse customer record receives one active permanent PIN and one active permanent QR token. They belong to the person record inside the Madhouse organisation, not to a location, membership, or membership period. Membership changes update access state but do not rotate either credential. An authorised staff member can explicitly reissue a compromised PIN or QR token; the old credential is revoked and the event is audited.

The PIN is eight digits. Eight digits remains practical on a physical keypad while providing 100 million possible values; generation uses cryptographic random bytes, a global active-credential uniqueness constraint, and collision retry. PIN and QR lookups use keyed SHA-256 HMAC values. The recoverable credential value is AES-256 encrypted with a database-only key so an authenticated member can view their own pass. Staff lists expose only a suffix, never the full PIN.

The QR payload is an opaque `R12-` token with 128 random bits. It contains no customer ID, name, email, entitlement, access decision, or unlock instruction. The Member app renders it as a standard QR code. PIN, QR, and future Wallet/NFC presentations all resolve to the same customer and the same server-side access decision.

## Fast access state

`club_member_access_projection` stores one indexed row per organisation/customer with the selected access membership, allow state, reason, validity window, grace state, entitlement scope, source, and recalculation timestamp. The membership and billing tables remain authoritative.

Database triggers synchronously refresh the projection when a membership, holder, product entitlement, billing obligation, billing suspension, or billing policy changes. Expiry is also checked against the current server time on every presentation, so a pass cannot remain usable after its end time even before a reconciliation run. A newly assigned or restored membership is available as soon as its transaction commits.

Payment failure, pending payment, and retry/grace states remain allowed unless the existing organisation policy has produced an active payment-access suspension. Disabling access suspension in policy immediately recalculates affected projections. No new dunning policy is introduced.

## Cross-site and day-pass behaviour

Carlton and Rotherham are locations in the same Madhouse organisation. Preferred/home location is never read by the access decision. An organisation-wide gym-access entitlement works at either venue. Only a product that explicitly carries a location-scoped entitlement can restrict a future specialist pass.

Day passes use the existing customer, membership holder, product entitlement, and membership validity model. The visitor does not require an Auth account. Their assigned PIN/QR resolves normally during the pass window and is denied immediately after `ends_at`; the person's credential itself is not coupled to or extended by that window.

## Location modes and attendance

- `CHECKIN_ONLY`: validate and audit; record the arrival; never permit automated unlock.
- `DOOR_CONTROLLED`: validate and audit; record the arrival; return `unlockPermitted: true` to an authenticated adapter when allowed.
- `DISABLED`: deny credential use at the venue.

The migration safely initialises Carlton and Rotherham to `CHECKIN_ONLY`. An owner or gym admin can switch a location through the audited `club_set_location_access_mode` RPC after the physical controller is ready. Changing mode never changes member credentials.

Every presentation creates an access-decision audit row with customer, actual location, credential type, allow/deny reason, projected state, time, device/source, mode, and unlock permission. A ten-second anti-bounce window records repeated presentations as decisions linked to the first event without creating another arrival. Raw PINs, QR tokens, and device secrets are not logged.

## Device boundary

The existing authenticated HTTP bridge accepts PIN, QR, legacy reference, and barcode presentations. It requires an active device ID, bearer secret, nonce, and fresh timestamp; rejects replayed nonces; limits device traffic; and temporarily throttles a device after ten unrecognised PIN attempts in five minutes. It returns a decision only. No controller protocol or hardware response has been invented.

Before enabling `DOOR_CONTROLLED`, Peter still needs to provide the real controller/reader vendor and model, supported integration mechanism, network topology, unlock command/relay contract, acknowledgement and timeout behaviour, device identity per entrance, and secure credential-provisioning process. Until then, Carlton and Rotherham can both run the same QR/reception `CHECKIN_ONLY` flow with attendance logging.

## Review and rollout

The schema is in `2026-12-04-member-pin-qr-access-pass.sql` and is included after the member-import/access migration in the deployment manifest. It has not been applied. Applying it later provisions stable credentials and projections for existing customers who hold gym-access products; it does not create a door device, provider credential, or hardware call.

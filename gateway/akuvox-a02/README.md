# Akuvox A02/A02S R12 PIN gateway (commissioning preparation)

This gateway is an on-premises HTTPS bridge. It does not decide membership
eligibility and does not store member PINs. It forwards the member's existing
PIN to R12's authenticated device decision endpoint. A positive result is
returned only when R12 explicitly says `allowed`, `decision: allow`, and
`unlockPermitted: true`. Any invalid request or upstream failure returns the
documented deny JSON.

## Trust boundaries

- Do not expose this process to the public Internet or put it behind a proxy
  that logs query strings. Akuvox sends its PIN in a URL query parameter, so
  URL/access logging must remain disabled on the gateway, reverse proxy,
  firewall and monitoring path.
- HTTPS is mandatory. The gateway refuses to start without a certificate and
  private key. Do not turn off TLS certificate verification on the keypad.
  Akuvox's published examples show HTTP URLs; HTTPS support and certificate
  validation on the installed A02S/firmware must be confirmed before use.
- Configure exact keypad source IPv4 addresses at the gateway and firewall,
  plus the configured device ID and Basic Authorization credentials. The
  exact source-IP check is an additional control, not a substitute for TLS or
  Basic auth. Do not use device ID as authentication.
- The gateway rate-limits all calls from the allowed keypad IP and suppresses
  reuse of a successfully accepted PIN for ten seconds in-process. It keeps
  only a one-way PIN fingerprint. Each forwarded request also gets a fresh R12
  nonce and timestamp, which R12 enforces. The Akuvox documentation does not
  describe a device-signed request nonce; therefore this is layered replay
  resistance, not cryptographic proof of request freshness. Keep the gateway
  on a protected LAN and confirm the final device request behaviour during
  commissioning.
- The gateway sends no Supabase/service-role credential. Its R12 device secret
  is a distinct per-device secret for the existing `club_device_access_decision`
  RPC path and is stored only on this trusted host.
- Keep Akuvox timeout at its documented three seconds. This bridge times the
  R12 request out after 1.8 seconds and denies on timeout. Keep the gateway on
  a wired, monitored LAN with outbound HTTPS to `app.r12.live` only.
- Do not enable the real relay until device firmware, HTTPS, Authorization
  Mode, URL templating and fail-deny behaviour are verified with the installer.

## Required configuration

Set these environment variables through the host's protected service manager;
never commit a populated env file:

| Variable | Purpose |
| --- | --- |
| `AKUVOX_TLS_CERT_FILE` / `AKUVOX_TLS_KEY_FILE` | TLS server certificate/key; certificate must be trusted by the keypad |
| `AKUVOX_BASIC_USERNAME` / `AKUVOX_BASIC_PASSWORD` | Unique high-entropy Basic credentials configured on the keypad |
| `AKUVOX_ALLOWED_SOURCE_IPS` | Comma-separated exact static keypad IPv4 addresses |
| `AKUVOX_DEVICE_ID` | Exact hardware identifier emitted by the keypad as `{DeviceID}`; pinned in gateway configuration |
| `R12_DEVICE_ID` | UUID of the pre-registered Rotherham row in `club_access_devices` |
| `R12_DEVICE_SECRET` | Secret corresponding to that row's existing SHA-256 `secret_hash` |
| `AKUVOX_GATEWAY_PORT` | Optional HTTPS listener port; default `8443` |

The Akuvox hardware identifier and R12 device UUID are separate values. Set
`AKUVOX_DEVICE_ID` to the exact identifier the installed keypad sends in
`{DeviceID}` (confirm it with the installer/device configuration), and set
`R12_DEVICE_ID` to the UUID returned by R12 provisioning. The gateway accepts
only an exact match to its configured hardware identifier and always forwards
the separately configured R12 UUID; the request cannot select an R12 device.
The Club Locations page provisions this exact Rotherham row for an active Madhouse
owner/gym admin, initially disabled. It returns the 32-byte random device
secret once; the database stores only its SHA-256 digest. The secret is not
recoverable after closing the one-time display. The keyring/service-role
credential must never be installed on the keypad or gateway.

## Run and configure

Use a supported maintained Node.js LTS runtime. Start with:

```sh
npx tsx gateway/akuvox-a02/gateway.ts
```

For unattended operation, install it as a system service on an always-on
on-premises host: start automatically at boot, restart automatically after
failure, run as a dedicated unprivileged account, and monitor process/host
health without request logging. Protect the environment file and TLS key with
owner-only filesystem permissions. The host, switch and router must stay
powered and network-connected while the gym is unattended; a UPS is
recommended for the gateway/network equipment. Do not run this in a staff
browser, temporary laptop session, or an internet-facing Vercel Function.

### Owner/admin provisioning procedure

1. Apply the reviewed additive device-admin migration through the normal
   controlled release process. Do not provision by direct table writes.
2. Apply `2026-11-14-rotherham-door-duration-request.sql` before using the
   Door Access duration controls. The R12 value is a requested relay hold
   duration; the UI does not send settings to the A02S. Only record the manual
   read-back after an owner/admin has viewed the device's saved value.
3. Sign in to Club as an active Madhouse owner or gym admin. Open Management →
   Venues & Settings (`/club/locations`) for the Madhouse organisation.
4. In **Akuvox gateway**, verify the displayed venue is Rotherham and inspect
   its current access mode. Choose **Register disabled gateway**. Record its
   returned UUID as `R12_DEVICE_ID`. Separately obtain the exact `{DeviceID}`
   value emitted by the physical keypad and configure that as `AKUVOX_DEVICE_ID`.
   These values need not match; do not guess or derive one from the other.
5. Copy the generated gateway secret immediately into the gateway host's
   protected environment. It is displayed once. The database holds only its
   digest; if the response is lost, resubmit the same form while it remains
   open to rotate the still-disabled record's secret. Never send the secret to
   the installer or enter it into the keypad.
6. Keep the database device status disabled until the gateway is installed,
   TLS/network checks pass, and a controlled test is ready. An owner/admin can
   enable it for decision testing only while Rotherham is explicitly
   `CHECKIN_ONLY`; the secure RPC rejects activation in `DOOR_CONTROLLED` mode.
   In Check-in only mode R12 returns `unlockPermitted: false`, so the gateway
   responds deny to the keypad even for an otherwise eligible member.
7. After separate physical commissioning and approval, an owner/admin may use
   the existing `club_set_location_access_mode(organisation_id, location_id,
   'DOOR_CONTROLLED')` RPC to change the existing venue setting. No code in
   this preparation changes that setting. Revoke the device immediately from
   Club if the gateway is lost or compromised.

The A02/A02S relay's local **Hold Delay** is configured in its device
interface. Akuvox lists the unified HTTP API for A01/A02 from firmware
`101.30.11.131`, including configuration retrieval and relay monitoring/control,
but the available specification summary does not establish a supported
write-and-read-back operation for this exact Hold Delay setting. Therefore R12 stores a requested value only.
It remains **Not synchronized** until an owner/admin and installer manually
set and read back the matching relay value; R12's audited confirmation records
that manual check and does not poll the device. Do not interpret it as live
hardware telemetry.

The Akuvox relay Hold Delay controls relay activation duration. If the door
sensor / **Relock When Door Closed** option is configured, Akuvox documents
that a detected physical closure can relock before the Hold Delay expires.
The installer must verify relay mode, door sensor, relock behaviour, output
polarity and the maglock connection. No website timer can hold or release the
physical lock.

## Network and power failure behaviour

- If the internet, gateway, or R12 decision service is unavailable, the
  gateway times out and returns a deny response. The software does not bypass
  membership, venue, access-window, device, or credential checks.
- If the keypad loses power or network connectivity, it cannot obtain a new
  PIN decision. Confirm the power supply and battery-backed runtime with the
  installer; runtime cannot be inferred from the software.
- A fail-safe maglock releases when its lock power is removed. Whether the
  installed battery keeps it energised, and how the supply is isolated by fire
  alarm or emergency controls, must be confirmed and physically tested by the
  installer/electrician.
- Fire alarm release, green exit button, and reception/manual release must
  operate independently of R12, the gateway, and internet connectivity. Do
  not rely on software for emergency egress or alter the wiring.

## Access policy prerequisite

The R12 device decision remains authoritative: the registered device selects
the physical organisation/location, validates the device secret and nonce,
then resolves the existing PIN and membership projection. Home gym is not a
membership restriction; explicit entitlement location scopes still apply.
The current local single-window Off-Peak source only represents Monday–Friday
10:00–15:00 and is marked superseded for Production. It cannot represent the
approved overnight periods. The forward-only
`2026-11-14-madhouse-off-peak-access-windows.sql` migration adds the confirmed
Europe/London windows to the existing membership policy guard. Its prerequisite
is exactly one sellable `madhouse.membership.off-peak.v1` product rule; it fails
closed if that product rule is absent. Do not move Rotherham to
`DOOR_CONTROLLED` until the migration has been applied through release control
and the live decision path has been verified.

For a controlled release, first verify the migration prerequisites against the
live schema. Apply
`2026-11-14-madhouse-off-peak-access-windows.sql` only after confirming the
single sellable Madhouse Off-Peak product rule, then apply
`2026-11-14-rotherham-akuvox-device-admin.sql` and
`2026-11-14-rotherham-door-duration-request.sql`. Deploy the matching
application only after all three migrations complete successfully. If the
Off-Peak prerequisite is absent or ambiguous, stop and resolve that separately;
do not switch Rotherham to door-controlled mode. None of these migration files
has been applied by this preparation task.

Configure customized PIN integration using the A02/A02S variable spelling
published for this model, with a URL equivalent to:

```text
https://<trusted-gateway-host>:8443/akuvox/a02/pin?pin={PINCode}&deviceId={DeviceID}&time={Time}
```

Select Basic Authorization and configure the gateway credentials. Do not
configure the keypad with a public Vercel URL, HTTP URL, service-role key, or
R12 device secret. The `{Time}` value is accepted only as an unused diagnostic
parameter in this version; replay resistance is enforced for the gateway's
server-to-server request by R12's nonce/timestamp checks. Gateway authentication,
source-IP restriction and network controls protect the incoming keypad request.

## Simulated tests

From repository root, run:

```sh
npx tsx --test tests/akuvox-a02-gateway.test.ts tests/akuvox-device-provisioning.test.ts tests/akuvox-door-duration.test.ts tests/madhouse-off-peak-access-windows.test.ts tests/member-fast-gym-access.test.ts tests/member-pin-qr-access.test.ts
```

Tests use a mocked upstream. They never call Production, read a real PIN, or
operate a door.

## Commissioning checklist for installer

1. Record exact A02S model, hardware revision, firmware build and whether it
   meets A02 third-party PIN integration minimum `101.30.10.128`. Firmware
   `101.30.11.124` or later is required for the documented explicit success /
   failure response parameters.
2. Confirm customized third-party PIN mode and exact `{PINCode}` substitution.
3. Confirm installed firmware supports HTTPS with certificate validation and
   Basic Authorization. Do not proceed over plaintext HTTP or with TLS
   verification disabled. If unsupported, stop for a separately reviewed
   secure network design; do not send PINs over an untrusted network.
4. Assign a static DHCP reservation to the keypad and provide its IP, gateway,
   subnet/VLAN and DNS/time configuration to the R12 operator.
5. Confirm the Off-Peak product rule and live time-window guard before the
   Rotherham mode can be changed. The approved policy is Mon–Fri 10:00–15:00
   and 22:00–03:00 across the following calendar day, with no Saturday night,
   Sunday, or Monday 00:00–03:00 access. Times are Europe/London local time.
6. Use the Club owner/admin flow to register the disabled Rotherham device;
   verify its organisation, location and UUID. Keep the one-time secret on the
   gateway host only.
7. Install the gateway host on the trusted LAN, install a trusted TLS
   certificate, restrict inbound firewall access to the keypad IP and outbound
   access to `app.r12.live:443`, and verify logs do not include query strings.
8. In the Akuvox interface, set Relay A Hold Delay to the R12 requested value
   (default 5 seconds), check the installer-selected monostable/door-sensor
   behavior, read the saved value back, then record that manual read-back in
   Club. This is not remote synchronization.
9. Test first with relay disabled and a dedicated test member in an approved
   non-production environment: valid active entitlement, invalid PIN, expired
   membership, wrong venue, disabled device, gateway down, backend timeout,
   bad Basic credentials and stale/repeated calls. Confirm every failure denies.
10. With the installer present, conduct real entry tests only after explicit
   operational approval. Confirm unlock/audit result and inspect mechanical
   release, exit button and fire-system behaviour independently. This software
   does not configure or override any physical safety circuit.
11. Keep the existing QR system unchanged. Record rollback steps: disable the
   Akuvox third-party integration/relay path and use the existing approved
   entry process. Never alter the member's existing R12 PIN.

The manufacturer documents PIN forwarding as `{PINCode}`, Basic/Digest
authorization options and a JSON `isvalid` response. Its public article's
sample URLs use HTTP; HTTPS support for the installed device must be confirmed
before this gateway can be used.

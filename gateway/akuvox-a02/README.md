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
| `AKUVOX_DEVICE_ID` | Exact ID configured in Akuvox and substituted as `{DeviceID}` |
| `R12_DEVICE_ID` | UUID of the pre-registered Rotherham row in `club_access_devices` |
| `R12_DEVICE_SECRET` | Secret corresponding to that row's existing SHA-256 `secret_hash` |
| `AKUVOX_GATEWAY_PORT` | Optional HTTPS listener port; default `8443` |

The device UUID and matching secret require authorised provisioning of the
existing `club_access_devices` row for the Madhouse organisation and Rotherham
location. This repository currently has no supported device-provisioning UI or
command. Do not invent a row or hash manually: complete this through the
approved operations process before commissioning. The keyring/service-role
credential must never be installed on the keypad or gateway.

## Run and configure

Use a supported maintained Node.js LTS runtime. Start with:

```sh
npx tsx gateway/akuvox-a02/gateway.ts
```

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
npx tsx --test tests/akuvox-a02-gateway.test.ts tests/member-fast-gym-access.test.ts
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
5. Provision/register the Rotherham device row through the authorised process;
   verify its organisation, location, active status, device UUID and secret
   pairing without exposing the secret to the installer or keypad.
6. Install the gateway host on the trusted LAN, install a trusted TLS
   certificate, restrict inbound firewall access to the keypad IP and outbound
   access to `app.r12.live:443`, and verify logs do not include query strings.
7. Test first with relay disabled and a dedicated test member in an approved
   non-production environment: valid active entitlement, invalid PIN, expired
   membership, wrong venue, disabled device, gateway down, backend timeout,
   bad Basic credentials and stale/repeated calls. Confirm every failure denies.
8. With the installer present, conduct real entry tests only after explicit
   operational approval. Confirm unlock/audit result and inspect mechanical
   release, exit button and fire-system behaviour independently. This software
   does not configure or override any physical safety circuit.
9. Keep the existing QR system unchanged. Record rollback steps: disable the
   Akuvox third-party integration/relay path and use the existing approved
   entry process. Never alter the member's existing R12 PIN.

The manufacturer documents PIN forwarding as `{PINCode}`, Basic/Digest
authorization options and a JSON `isvalid` response. Its public article's
sample URLs use HTTP; HTTPS support for the installed device must be confirmed
before this gateway can be used.

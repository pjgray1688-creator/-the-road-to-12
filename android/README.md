# R12 Android release checklist

The four Trusted Web Activities use the Next.js application at `https://app.r12.live`. Android descriptors retain separate package IDs, icons and path-limited URL scopes.

| App | Audience and launch | Package ID | PWA manifest | Upload keystore |
|---|---|---|---|---|
| R12 | Personal training · `/training` | `live.r12.training` | `/manifest.webmanifest` | `android/signing/r12-upload.jks` (`r12-upload`) |
| R12 Club | Staff reception · `/club/reception` | `live.r12.club` | `/club/manifest.webmanifest` | `android/signing/club-upload.jks` (`club-upload`) |
| R12 Coach | Coaches · `/coach` | `live.r12.coach` | `/coach/manifest.webmanifest` | `android/signing/coach-upload.jks` (`coach-upload`) |
| Glow Zone | Glow Zone customers · `/glow-zone` | `live.r12.glowzone` | `/glow-zone/manifest.webmanifest` | `android/signing/glow-zone-upload.jks` (`glow-zone-upload`) |

## Digital Asset Links

The website association must use each app's **Play App Signing** certificate. In Play Console, open each app's **App integrity / App signing** page and copy the SHA-256 value under **App signing key certificate** for:

- `live.r12.training`
- `live.r12.club`
- `live.r12.coach`
- `live.r12.glowzone`

Do not use the upload-key certificate. If Play shows multiple active app-signing certificates because of a signing-key upgrade, include each certificate that signs delivered installs for that app.

Set the production Vercel environment variable `R12_ANDROID_APP_LINKS_JSON` to a JSON array of four objects with `package_name` and `sha256_cert_fingerprints`. Example shape only; replace every placeholder with the fingerprint copied from that app's Play App Signing certificate:

```json
[
  { "package_name": "live.r12.training", "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>"] },
  { "package_name": "live.r12.club", "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>"] },
  { "package_name": "live.r12.coach", "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>"] },
  { "package_name": "live.r12.glowzone", "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>"] }
]
```

This is public association data, not a secret. The endpoint only returns HTTP 200 after all four package IDs have at least one correctly formatted fingerprint. Until then it returns HTTP 503 and preserves any already configured valid app statements in the JSON body (or `[]` if none are configured). After deployment, verify the endpoint returns `Content-Type: application/json` and exactly four statements, then test `/training`, `/club`, `/coach`, and `/glow-zone` using Play-installed apps.

## Build and signing

1. Confirm `app.r12.live` is assigned to this Vercel project and serves the app routes over HTTPS before Android release.
2. Install/use a JDK, Android SDK Platform 36 and Build Tools, Google Bubblewrap CLI, and Gradle. The build script refuses to produce an AAB unless Bubblewrap generated `targetSdkVersion 36`.
3. Reserve the four package IDs in Play Console, enable Play App Signing, create one upload key per app, and store the keys/passwords in the approved vault. Never put signing keys or passwords in Git.
4. From the repository root, validate and generate unsigned bundles:

   ```sh
   npm run android:validate
   npm run android:build -- r12
   npm run android:build -- club
   npm run android:build -- coach
   npm run android:build -- glow-zone
   ```

   The unsigned AAB is `android/apps/<app>/app-release-bundle.aab` (or the Gradle output at `android/apps/<app>/app/build/outputs/bundle/release/app-release.aab` if Bubblewrap leaves the generated artifact there).
5. For each signed upload bundle, set `BUBBLEWRAP_KEYSTORE_PASSWORD` and `BUBBLEWRAP_KEY_PASSWORD` from the vault in the shell, then run `npm run android:build -- <app> --signed`. Bubblewrap writes `app-release-bundle.aab` under that app's project. Do not put passwords in command arguments or shell history.
6. Inspect each bundle, install a test build, and verify sign-in/role access, return navigation, app links and fullscreen TWA verification before Play Console upload.

## Current readiness

- The Production `R12_ANDROID_APP_LINKS_JSON` value is configured as four package/fingerprint objects. The current source now accepts this format and emits the four Digital Asset Links statements. Production must be redeployed from a commit containing these changes before the endpoint can use it.
- No Java runtime, Android SDK, `adb`, Bubblewrap CLI or Gradle command is available on the current Mac environment. No AAB can be built here until the toolchain is available.
- Generated Android manifests and Play artifacts are not checked into this repository; validate the installed Play builds' URL intent filters if `/training` remains unverified after the website deployment.
- Club opens the existing authenticated staff reception workflow. It requires a staff role and the `members.view` capability, then preserves organisation/location selection. It does not launch Member Hub.

Quick Mac checks before installing anything:

```sh
java -version
sdkmanager --version
adb version
bundletool version
bubblewrap --version
gradle --version
```

`java` must return a working JDK, not only the macOS launcher stub. Check installed Android packages with `sdkmanager --list_installed` and confirm `platforms;android-36` and `build-tools;36.*` are present.

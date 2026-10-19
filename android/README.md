# R12 Android release checklist

The four Trusted Web Activities use the Next.js application at `https://app.r12.live`. Android descriptors retain separate package IDs, icons and path-limited URL scopes.

| App | Audience and launch | Package ID | PWA manifest | Upload keystore |
|---|---|---|---|---|
| R12 | Personal training · `/training` | `live.r12.training` | `/manifest.webmanifest` | `android/signing/r12-upload.jks` (`r12-upload`) |
| R12 Club | Staff reception · `/club/reception` | `live.r12.club` | `/club/manifest.webmanifest` | `android/signing/club-upload.jks` (`club-upload`) |
| R12 Coach | Coaches · `/coach` | `live.r12.coach` | `/coach/manifest.webmanifest` | `android/signing/coach-upload.jks` (`coach-upload`) |
| Glow Zone | Glow Zone customers · `/glow-zone` | `live.r12.glowzone` | `/glow-zone/manifest.webmanifest` | `android/signing/glow-zone-upload.jks` (`glow-zone-upload`) |

## Build and signing

1. Confirm `app.r12.live` is assigned to this Vercel project and serves the app routes. It is currently absent from the project's returned domain list; do not build or release until the Vercel project owner resolves this.
2. Publish the app and verify all four manifest and icon URLs plus `https://app.r12.live/.well-known/assetlinks.json`. Configure `R12_ANDROID_APP_LINKS_JSON` from each app's **Play App Signing** SHA-256 fingerprint. The endpoint intentionally returns 503 until valid fingerprints are configured.
3. Install/use a JDK, Android SDK Platform 36 and Build Tools, Google Bubblewrap CLI, and Gradle. The build script refuses to produce an AAB unless Bubblewrap generated `targetSdkVersion 36`.
4. Reserve the four package IDs in Play Console, enable Play App Signing, create one upload key per app, and store the keys/passwords in the approved vault. Never put signing keys or passwords in Git.
5. From the repository root, validate and generate unsigned bundles:

   ```sh
   npm run android:validate
   npm run android:build -- r12
   npm run android:build -- club
   npm run android:build -- coach
   npm run android:build -- glow-zone
   ```

   The unsigned AAB is `android/apps/<app>/app-release-bundle.aab` (or the Gradle output at `android/apps/<app>/app/build/outputs/bundle/release/app-release.aab` if Bubblewrap leaves the generated artifact there).
6. For each signed upload bundle, set `BUBBLEWRAP_KEYSTORE_PASSWORD` and `BUBBLEWRAP_KEY_PASSWORD` from the vault in the shell, then run `npm run android:build -- <app> --signed`. Bubblewrap writes `app-release-bundle.aab` under that app's project. Do not put passwords in command arguments or shell history.
7. Inspect each bundle, install a test build, and verify sign-in/role access, return navigation, app links and fullscreen TWA verification before Play Console upload.

## Current readiness

- The repository now targets `app.r12.live`; Vercel currently reports only `the-road-to-12.vercel.app` aliases for this project, so the requested custom hostname is an external blocker.
- No Java runtime, Android SDK, `adb`, Bubblewrap CLI or Gradle command is available on the current Mac environment. No AAB can be built here until the toolchain is available.
- No upload keystores or Play App Signing fingerprints were supplied. No keys or fingerprints were generated or fabricated. Signed bundles and verified fullscreen launches therefore remain blocked.
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

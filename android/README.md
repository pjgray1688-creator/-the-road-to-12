# R12 Android release shells

These are four Trusted Web Activity shells over the single `https://r12.live` application/backend. They contain no billing logic, credentials, private keys or duplicate Glow Zone service.

| App | Package | Launch | Verified link prefix | Manifest |
|---|---|---|---|---|
| R12 | `live.r12.training` | `/training` | `/training` | `/manifest.webmanifest` |
| R12 Club | `live.r12.club` | `/member-hub` | `/member-hub` | `/member-hub/manifest.webmanifest` |
| R12 Coach | `live.r12.coach` | `/coach` | `/coach` | `/coach/manifest.webmanifest` |
| Glow Zone | `live.r12.glowzone` | `/glow-zone` | `/glow-zone` | `/glow-zone/manifest.webmanifest` |

Path-specific `fullScopeUrl` values stop all four packages claiming every `r12.live` deep link. Shared same-origin account/auth navigation remains within the verified TWA origin.

## Build prerequisites and commands

- Deploy and verify all routes/manifests/icons on `r12.live`.
- Install a JDK, Android SDK API 36 and current Google Bubblewrap CLI.
- Create the exact packages in Play Console and enrol each in Play App Signing.
- Create one upload key per package outside Git in `android/signing/`, using the descriptor paths/aliases, and store keys/passwords in the organisation vault.
- Configure the four **Play app-signing** SHA-256 fingerprints (not upload fingerprints) in `R12_ANDROID_APP_LINKS_JSON`. Until then `/.well-known/assetlinks.json` intentionally returns 503.

```sh
npm run android:validate
npm run android:build -- r12
npm run android:build -- club
npm run android:build -- coach
npm run android:build -- glow-zone
```

These builds use `--skipSigning`; inspect unsigned AABs at `android/apps/<app>/app/build/outputs/bundle/release/app-release.aab`. For authorised release builds set Bubblewrap password environment variables and append `--signed`; expected upload output is `app-release-bundle.aab`. Never store passwords in Git, JSON or Gradle.

After generation rerun validation (it checks target API 36), inspect with bundletool, generate/install test APKs, and exercise the matrix in the release plan. Browser chrome on launch means Digital Asset Links verification failed.

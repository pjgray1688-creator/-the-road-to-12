import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const apps = [
  { key: "r12", packageId: "live.r12.training", start: "/training", manifest: "/manifest.webmanifest", deepLink: "/training", route: "app/manifest.ts", icon: "icon-512.png", identity: 'webManifest("r12")' },
  { key: "club", packageId: "live.r12.club", start: "/club/reception", manifest: "/club/manifest.webmanifest", deepLink: "/club", route: "app/club/manifest.webmanifest/route.ts", icon: "club-icon-512.png", identity: 'manifestResponse("club")' },
  { key: "coach", packageId: "live.r12.coach", start: "/coach", manifest: "/coach/manifest.webmanifest", deepLink: "/coach", route: "app/coach/manifest.webmanifest/route.ts", icon: "coach-icon-512.png", identity: 'manifestResponse("coach")' },
  { key: "glow-zone", packageId: "live.r12.glowzone", start: "/glow-zone", manifest: "/glow-zone/manifest.webmanifest", deepLink: "/glow-zone", route: "app/glow-zone/manifest.webmanifest/route.ts", icon: "glow-zone-icon-512.png", identity: 'manifestResponse("glowZone")' },
];

test("four Android descriptors retain app identities and use app.r12.live route assets", () => {
  const ids = new Set<string>();
  for (const app of apps) {
    const descriptor = JSON.parse(readFileSync(`${root}/android/apps/${app.key}/twa-manifest.json`, "utf8"));
    assert.equal(descriptor.packageId, app.packageId);
    assert.equal(descriptor.host, "app.r12.live");
    assert.equal(descriptor.startUrl, app.start);
    assert.equal(descriptor.webManifestUrl, `https://app.r12.live${app.manifest}`);
    assert.equal(descriptor.fullScopeUrl, `https://app.r12.live${app.deepLink}`);
    assert.equal(descriptor.iconUrl, `https://app.r12.live/r12-app-assets/${app.icon}`);
    assert.equal(descriptor.maskableIconUrl, descriptor.iconUrl);
    assert.ok(existsSync(`${root}/public/r12-app-assets/${app.icon}`));
    assert.ok(readFileSync(`${root}/${app.route}`, "utf8").includes(app.identity));
    assert.equal(descriptor.fingerprints.length, 0, "Play signing fingerprints must not be fabricated or committed");
    assert.ok(!ids.has(app.packageId));
    ids.add(app.packageId);
  }
  assert.equal(ids.size, 4);
});

test("Club app enters staff reception, never the member hub, with staff and capability gates", () => {
  const club = JSON.parse(readFileSync(`${root}/android/apps/club/twa-manifest.json`, "utf8"));
  const reception = readFileSync(`${root}/app/club/reception/page.tsx`, "utf8");
  const access = readFileSync(`${root}/app/club/access/page.tsx`, "utf8");
  const console = readFileSync(`${root}/components/club-access-console.tsx`, "utf8");
  const actions = readFileSync(`${root}/app/club/access/actions.ts`, "utf8");
  assert.equal(club.startUrl, "/club/reception");
  assert.equal(club.webManifestUrl, "https://app.r12.live/club/manifest.webmanifest");
  assert.match(reception, /redirect\(`\/club\/access/);
  assert.match(access, /isClubStaffRole\(context\.role\)/);
  assert.match(access, /hasCapability\(context\.organisation\.id, user\.id, "members\.view"\)/);
  assert.match(access, /staffContexts\.length > 1/);
  assert.match(access, /club\/reception\?org=/);
  assert.match(access, /locationId = locations\.some\(location => location\.active && location\.id === params\?\.location\)/);
  assert.match(access, /initialLocationId=\{locationId\}/);
  assert.match(console, /initialLocationId\?: string/);
  assert.match(actions, /isClubStaffRole\(club\.role\)/);
  assert.match(actions, /hasCapability\(organisationId, user\.id, "members\.view"\)/);
  assert.doesNotMatch(club.startUrl, /member-hub/);
});

test("standard Digital Asset Links route reuses the validated fingerprint handler", () => {
  const standard = readFileSync(`${root}/app/.well-known/assetlinks.json/route.ts`, "utf8");
  const api = readFileSync(`${root}/app/api/android/assetlinks/route.ts`, "utf8");
  const config = readFileSync(`${root}/lib/android-apps.ts`, "utf8");
  assert.match(standard, /export \{ GET \} from "@\/app\/api\/android\/assetlinks\/route"/);
  assert.match(api, /androidAssetLinks\(process\.env\.R12_ANDROID_APP_LINKS_JSON\)/);
  assert.match(standard, /force-dynamic/);
  assert.match(api, /force-dynamic/);
  assert.match(config, /sha256Fingerprint/);
  assert.match(config, /delegate_permission\/common\.handle_all_urls/);
});

test("Android build scripts guard API 36 and provide unsigned and signed AAB paths", () => {
  const build = readFileSync(`${root}/android/scripts/build.mjs`, "utf8");
  const validate = readFileSync(`${root}/android/scripts/validate-config.mjs`, "utf8");
  assert.match(build, /targetSdkVersion\\s\+36/);
  assert.match(build, /--skipSigning/);
  assert.match(build, /BUBBLEWRAP_KEYSTORE_PASSWORD/);
  assert.match(build, /BUBBLEWRAP_KEY_PASSWORD/);
  assert.match(build, /app-release-bundle\.aab/);
  assert.match(build, /Bubblewrap completed without producing an AAB/);
  assert.match(validate, /targetSdkVersion/);
});

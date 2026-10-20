import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { androidAssetLinks, manifestResponse } from "../lib/android-apps";

const root = process.cwd();
const apps = [
  { key: "club", route: "app/club/manifest.webmanifest/route.ts", start: "/club/reception", icon: "club-icon-512.png" },
  { key: "coach", route: "app/coach/manifest.webmanifest/route.ts", start: "/coach", icon: "coach-icon-512.png" },
  { key: "glowZone", route: "app/glow-zone/manifest.webmanifest/route.ts", start: "/glow-zone", icon: "glow-zone-icon-512.png" },
] as const;

test("Club, Coach and Glow Zone manifest routes return valid app-specific manifests and icons", async () => {
  for (const app of apps) {
    const route = readFileSync(`${root}/${app.route}`, "utf8");
    assert.match(route, new RegExp(`manifestResponse\\("${app.key}"\\)`));

    const response = manifestResponse(app.key);
    const manifest = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/manifest\+json/);
    assert.equal(manifest.start_url, app.start);
    const icons = manifest.icons as Array<{ src: string; purpose?: string }>;
    assert.ok(icons.some(icon => icon.src === `/r12-app-assets/${app.icon}`));
    assert.ok(icons.some(icon => icon.purpose === "maskable"));
    for (const icon of icons) assert.ok(existsSync(`${root}/public${icon.src}`), `${icon.src} exists`);
  }
});

test("Digital Asset Links route stays live without inventing signing fingerprints", () => {
  const standard = readFileSync(`${root}/app/.well-known/assetlinks.json/route.ts`, "utf8");
  const api = readFileSync(`${root}/app/api/android/assetlinks/route.ts`, "utf8");
  assert.match(standard, /export \{ GET \} from "@\/app\/api\/android\/assetlinks\/route"/);
  assert.match(api, /androidAssetLinks\(process\.env\.R12_ANDROID_APP_LINKS_JSON\)/);
  assert.deepEqual(androidAssetLinks(undefined), []);
});

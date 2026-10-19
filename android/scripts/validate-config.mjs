import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const expected = {
  r12: ["live.r12.training", "/training", "/manifest.webmanifest", "/training", "app/manifest.ts", "r12-app-assets/icon-512.png"],
  club: ["live.r12.club", "/club/reception", "/club/manifest.webmanifest", "/club", "app/club/manifest.webmanifest/route.ts", "r12-app-assets/club-icon-512.png"],
  coach: ["live.r12.coach", "/coach", "/coach/manifest.webmanifest", "/coach", "app/coach/manifest.webmanifest/route.ts", "r12-app-assets/coach-icon-512.png"],
  "glow-zone": ["live.r12.glowzone", "/glow-zone", "/glow-zone/manifest.webmanifest", "/glow-zone", "app/glow-zone/manifest.webmanifest/route.ts", "r12-app-assets/glow-zone-icon-512.png"],
};
const packageIds = new Set();
for (const [key, [packageId, startUrl, manifestPath, deepLinkPath, routePath, iconPath]] of Object.entries(expected)) {
  const configPath = resolve(root, `android/apps/${key}/twa-manifest.json`);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.packageId !== packageId || config.host !== "app.r12.live" || config.startUrl !== startUrl) throw new Error(`${key}: package, app host or launch URL mismatch`);
  if (config.webManifestUrl !== `https://app.r12.live${manifestPath}` || config.fullScopeUrl !== `https://app.r12.live${deepLinkPath}`) throw new Error(`${key}: manifest or deep-link scope mismatch`);
  if (config.iconUrl !== `https://app.r12.live/${iconPath}` || config.maskableIconUrl !== config.iconUrl || !existsSync(resolve(root, `public/${iconPath}`))) throw new Error(`${key}: app icon URL or asset mismatch`);
  if (config.enableNotifications !== false || config.fallbackType !== "customtabs") throw new Error(`${key}: release permissions/fallback changed`);
  if (!Array.isArray(config.fingerprints) || config.fingerprints.length) throw new Error(`${key}: certificate fingerprints must be supplied through validated release configuration, not descriptors`);
  const route = readFileSync(resolve(root, routePath), "utf8");
  if (key === "r12" ? !route.includes('webManifest("r12")') : !route.includes(`manifestResponse("${key === "glow-zone" ? "glowZone" : key}")`)) throw new Error(`${key}: manifest route is not connected to its Android identity`);
  if (packageIds.has(config.packageId)) throw new Error(`${key}: duplicate package ID`);
  packageIds.add(config.packageId);
  const gradle = resolve(root, `android/apps/${key}/app/build.gradle`);
  if (existsSync(gradle) && !/targetSdkVersion\s+36\b/.test(readFileSync(gradle, "utf8"))) throw new Error(`${key}: generated project must target API 36`);
}
const standardAssetLinksRoute = resolve(root, "app/.well-known/assetlinks.json/route.ts");
const assetLinksHandler = resolve(root, "app/api/android/assetlinks/route.ts");
if (!existsSync(standardAssetLinksRoute) || !readFileSync(standardAssetLinksRoute, "utf8").includes('export { GET } from "@/app/api/android/assetlinks/route"')) throw new Error("Standard Digital Asset Links route must reuse the validated API handler");
if (!readFileSync(assetLinksHandler, "utf8").includes("androidAssetLinks(process.env.R12_ANDROID_APP_LINKS_JSON)")) throw new Error("Digital Asset Links route must use the validated Play signing fingerprint configuration");
const buildScript = readFileSync(resolve(root, "android/scripts/build.mjs"), "utf8");
if (!buildScript.includes("targetSdkVersion\\s+36") || !buildScript.includes("BUBBLEWRAP_KEYSTORE_PASSWORD") || !buildScript.includes("BUBBLEWRAP_KEY_PASSWORD")) throw new Error("Build script must guard API 36 and support Bubblewrap's documented signing environment variables");
console.log(`Validated ${packageIds.size} Android release descriptors, PWA routes, icons and Digital Asset Links routing. Generated projects are required to target API 36.`);

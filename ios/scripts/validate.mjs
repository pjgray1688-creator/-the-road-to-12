import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSpecs = [
  { folder: "R12", project: "R12", bundle: "live.r12.training", route: "/training", scheme: "r12-training", icon: "icon-512.png" },
  { folder: "R12Club", project: "R12Club", bundle: "live.r12.club", route: "/club/checks", scheme: "r12-club", icon: "club-icon-512.png" },
  { folder: "R12Coach", project: "R12Coach", bundle: "live.r12.coach", route: "/coach", scheme: "r12-coach", icon: "coach-icon-512.png" },
  { folder: "GlowZone", project: "GlowZone", bundle: "live.r12.glowzone", route: "/glow-zone", scheme: "r12-glowzone", icon: "glow-zone-icon-512.png" },
];

const check = (condition, message) => {
  assert.ok(condition, message);
  console.log(`ok - ${message}`);
};

const source = readFileSync(resolve(root, "Shared/RouteWebScreen.swift"), "utf8");
const configuration = readFileSync(resolve(root, "Shared/AppConfiguration.swift"), "utf8");
check(source.includes("webConfiguration.websiteDataStore = .default()"), "web views use WKWebView's persistent default website store");
check(source.includes('url.host == "app.r12.live"'), "first-party web navigation is restricted to app.r12.live");
check(source.includes("SFSafariViewController"), "external HTTPS destinations use in-app Safari");
check(source.includes('"Check your connection and try again."'), "failed page loads show a retry path");

for (const app of appSpecs) {
  const appRoot = resolve(root, app.folder);
  const projectPath = resolve(appRoot, `${app.project}.xcodeproj/project.pbxproj`);
  const project = readFileSync(projectPath, "utf8");
  const info = readFileSync(resolve(appRoot, "App/Info.plist"), "utf8");
  const appIcon = resolve(appRoot, "App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");
  const contents = JSON.parse(readFileSync(resolve(dirname(appIcon), "Contents.json"), "utf8"));
  check(project.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${app.bundle};`), `${app.folder} has its own bundle ID`);
  check(project.includes("IPHONEOS_DEPLOYMENT_TARGET = 17.0;"), `${app.folder} targets supported iOS 17+ devices`);
  check(project.includes("../Shared/RouteWebScreen.swift"), `${app.folder} includes the shared authenticated web shell`);
  check(info.includes(`<string>${app.scheme}</string>`), `${app.folder} registers its own deep-link scheme`);
  check(info.includes(`https://app.r12.live/privacy`), `${app.folder} points to the existing privacy policy`);
  check(contents.images?.some(image => image.filename === "AppIcon-1024.png" && image.size === "1024x1024"), `${app.folder} declares a 1024px App Store icon`);
  check(existsSync(appIcon) && statSync(appIcon).size > 1000, `${app.folder} contains its app-specific icon`);
  check(existsSync(resolve(appRoot, "App/LaunchScreen.storyboard")), `${app.folder} has a branded launch screen`);
  check(existsSync(resolve(appRoot, `${app.project}.xcodeproj/xcshareddata/xcschemes/${app.project}.xcscheme`)), `${app.folder} has a shared Xcode scheme`);
  check(configuration.includes(`path: "${app.route}"`), `${app.folder} starts at ${app.route}`);
}

const club = configuration.match(/static let club = NativeAppConfiguration\(([\s\S]*?)\n    \)/)?.[1] ?? "";
check(club.includes("/club/checks") && club.includes("/club/induction") && !club.includes("/member-hub"), "R12 Club foregrounds daily checks and inductions, not Member Hub");
check(club.includes("scope: { $0 == \"/club\" || $0.hasPrefix(\"/club/\") || $0 == \"/account\" }"), "R12 Club allows only Club and shared account routes");
const coach = configuration.match(/static let coach = NativeAppConfiguration\(([\s\S]*?)\n    \)/)?.[1] ?? "";
check(coach.includes("/account") && !coach.includes("/member-hub"), "R12 Coach keeps shared account access and no Club member route");
const clubAccount = readFileSync(resolve(root, "../app/club/account/page.tsx"), "utf8");
const coachAccount = readFileSync(resolve(root, "../app/coach/account/page.tsx"), "utf8");
check(clubAccount.includes("/account/delete") && coachAccount.includes("/account/delete"), "Club and Coach expose account deletion navigation");
check(!/DEVELOPMENT_TEAM\s*=/.test(appSpecs.map(app => readFileSync(resolve(root, app.folder, `${app.project}.xcodeproj/project.pbxproj`), "utf8")).join("\n")), "no Team ID or signing identity is embedded in project settings");

const store = JSON.parse(readFileSync(resolve(root, "AppStoreConnect/apps.json"), "utf8"));
check(store.apps.length === 4 && store.apps.every((app, index) => app.bundleId === appSpecs[index].bundle), "App Store Connect draft lists all four distinct apps");
check(store.apps.every(app => app.sku === null), "App Store Connect SKUs are left for the owner to choose");
check(store.apps.every(app => app.subtitle && app.description && app.keywords && app.reviewWalkthrough), "all app listings have draft copy and a distinct review walkthrough");
const clubListing = store.apps.find(app => app.bundleId === "live.r12.club");
check(clubListing.description.includes("daily venue and equipment checks") && clubListing.description.includes("induction"), "Club listing accurately foregrounds mobile floor operations");
const checksAction = readFileSync(resolve(root, "../app/club/checks/actions.ts"), "utf8");
check(checksAction.includes("club_record_checklist_item") && checksAction.includes("p_status: \"complete\""), "one-tap Club checks save through the existing audited server RPC");
const checksPage = readFileSync(resolve(root, "../app/club/checks/page.tsx"), "utf8");
check(checksPage.includes("next=%2Fclub%2Fchecks"), "Club sign-in returns reviewers and staff to Daily checks");
const clubShell = readFileSync(resolve(root, "../components/club-shell.tsx"), "utf8");
check(clubShell.includes("[\"Inductions\", `/club/induction") && clubShell.includes("[\"Daily checks\", `/club/checks"), "mobile Club navigation surfaces checks and inductions first");
console.log("iOS source configuration validation passed.");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSpecs = [
  { folder: "R12", project: "R12", displayName: "R12", config: "r12", bundle: "live.r12.training", route: "/training", privacy: "/privacy", scheme: "r12-training" },
  { folder: "R12Club", project: "R12Club", displayName: "R12 Club", config: "club", bundle: "live.r12.club", route: "/club/reception", privacy: "/club/privacy", scheme: "r12-club" },
  { folder: "R12Coach", project: "R12Coach", displayName: "R12 Coach", config: "coach", bundle: "live.r12.coach", route: "/coach", privacy: "/coach/privacy", scheme: "r12-coach" },
  { folder: "GlowZone", project: "GlowZone", displayName: "Glow Zone", config: "glowZone", bundle: "live.r12.glowzone", route: "/glow-zone", privacy: "/glow-zone/privacy", scheme: "r12-glowzone" },
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
check(source.indexOf("R12WebView(url:") < source.indexOf("if let error = state.errorMessage"), "web view remains mounted beneath retry UI");
check(source.includes("UIRefreshControl()") && source.includes("keyboardDismissMode = .interactive"), "native pull-to-refresh and interactive keyboard dismissal are configured");
check(source.includes("webViewWebContentProcessDidTerminate"), "terminated web content has a recovery path");
const iconHashes = [];

for (const app of appSpecs) {
  const appRoot = resolve(root, app.folder);
  const projectPath = resolve(appRoot, `${app.project}.xcodeproj/project.pbxproj`);
  const project = readFileSync(projectPath, "utf8");
  const info = readFileSync(resolve(appRoot, "App/Info.plist"), "utf8");
  const launch = readFileSync(resolve(appRoot, "App/LaunchScreen.storyboard"), "utf8");
  const appIcon = resolve(appRoot, "App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");
  const contents = JSON.parse(readFileSync(resolve(dirname(appIcon), "Contents.json"), "utf8"));
  const appConfiguration = configuration.match(new RegExp(`static let ${app.config} = NativeAppConfiguration\\(([\\s\\S]*?)\\n    \\)`))?.[1] ?? "";
  const firstRoute = appConfiguration.match(/destinations:\s*\[\s*AppDestination\([^]*?path: "([^"]+)"/)?.[1];
  const routeFile = resolve(root, `../app${app.route}/page.tsx`);
  check(project.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${app.bundle};`), `${app.folder} has its own bundle ID`);
  check(project.includes("IPHONEOS_DEPLOYMENT_TARGET = 17.0;"), `${app.folder} targets supported iOS 17+ devices`);
  check(["AppConfiguration.swift", "NativeAppShell.swift", "RouteWebScreen.swift"].every(file => project.includes(`../Shared/${file}`)), `${app.folder} includes the shared app navigation and authenticated web shell`);
  check(info.includes(`<string>${app.scheme}</string>`), `${app.folder} registers its own deep-link scheme`);
  check(info.includes(`<string>${app.displayName}</string>`), `${app.folder} declares its app-specific display name`);
  check(launch.includes('image="LaunchLogo"') || launch.includes(`text="${app.displayName}"`) || launch.includes(`${app.folder === "GlowZone" ? "GlowLaunch" : app.displayName}`), `${app.folder} launch screen uses its app name or approved brand asset`);
  check(info.includes(`<string>https://app.r12.live${app.privacy}</string>`), `${app.folder} points to its app-specific privacy policy`);
  check(appConfiguration.includes(`privacyPath: "${app.privacy}"`), `${app.folder} has an app-specific native privacy shortcut`);
  check(info.includes("<key>NSAllowsArbitraryLoads</key>\n\t\t<false/>"), `${app.folder} keeps arbitrary cleartext loads disabled`);
  check(contents.images?.some(image => image.filename === "AppIcon-1024.png" && image.size === "1024x1024"), `${app.folder} declares a 1024px App Store icon`);
  check(existsSync(appIcon) && statSync(appIcon).size > 1000, `${app.folder} contains its app-specific icon`);
  iconHashes.push(createHash("sha256").update(readFileSync(appIcon)).digest("hex"));
  check(existsSync(resolve(appRoot, "App/LaunchScreen.storyboard")), `${app.folder} has a branded launch screen`);
  check(existsSync(resolve(appRoot, `${app.project}.xcodeproj/xcshareddata/xcschemes/${app.project}.xcscheme`)), `${app.folder} has a shared Xcode scheme`);
  check(firstRoute === app.route, `${app.folder} starts at ${app.route}`);
  check(existsSync(routeFile), `${app.folder} entry route exists in the Next.js app`);
}
check(new Set(iconHashes).size === appSpecs.length, "all four App Store icons are visually distinct assets");

const club = configuration.match(/static let club = NativeAppConfiguration\(([\s\S]*?)\n    \)/)?.[1] ?? "";
check(club.includes("/club/checks") && club.includes("/club/induction") && !club.includes("/member-hub"), "R12 Club foregrounds daily checks and inductions, not Member Hub");
const clubReception = readFileSync(resolve(root, "../app/club/reception/page.tsx"), "utf8");
const clubAccess = readFileSync(resolve(root, "../app/club/access/page.tsx"), "utf8");
check(clubReception.includes("/club/access") && clubAccess.includes("next=%2Fclub%2Freception"), "Club reception enters the staff-authenticated access workflow");
check(clubAccess.includes("listClubOrganisationContexts") && clubAccess.includes("isClubStaffRole"), "Club reception retains organisation selection and staff role checks");
check(club.includes("scope: { $0 == \"/club\" || $0.hasPrefix(\"/club/\") || $0 == \"/account\" }"), "R12 Club allows only Club and shared account routes");
const coach = configuration.match(/static let coach = NativeAppConfiguration\(([\s\S]*?)\n    \)/)?.[1] ?? "";
const coachNative = readFileSync(resolve(root, "R12Coach/App/CoachNativeShell.swift"), "utf8");
check(coach.includes("/account") && !coach.includes("/member-hub"), "R12 Coach keeps shared account access and no Club member route");
check(["Clients", "Diary", "Programmes", "Nutrition", "Account"].every(title => coachNative.includes(`title: "${title}"`)), "R12 Coach has the five approved native destinations");
check(coachNative.includes("toolbar(.hidden, for: .navigationBar)") && coachNative.includes("safeAreaInset(edge: .bottom"), "R12 Coach uses one safe-area-aware native navigation bar");
check(configuration.includes('AppDestination(title: "Training", path: "/training"') && configuration.includes('AppDestination(title: "Progress", path: "/progress"'), "R12 Training exposes workout and progress destinations");
check(configuration.includes('AppDestination(title: "Home", path: "/glow-zone"'), "Glow Zone opens its customer-facing balance experience");
const coachEntry = readFileSync(resolve(root, "../app/coach/page.tsx"), "utf8");
const glowEntry = readFileSync(resolve(root, "../app/glow-zone/page.tsx"), "utf8");
check(coachEntry.includes("authenticatedServerClient") && coachEntry.includes("app=coach") && coachEntry.includes("mode=signIn"), "R12 Coach redirects signed-out users to branded sign-in");
check(glowEntry.includes("serverSupabase") && glowEntry.includes("app=glow") && glowEntry.includes("mode=signIn"), "Glow Zone retains branded sign-in gating on its customer route");
const clubAccount = readFileSync(resolve(root, "../app/club/account/page.tsx"), "utf8");
const coachAccount = readFileSync(resolve(root, "../app/coach/account/page.tsx"), "utf8");
const sharedAccount = readFileSync(resolve(root, "../app/account/page.tsx"), "utf8");
check(clubAccount.includes("/account/delete") && coachAccount.includes("/account/delete"), "Club and Coach expose account deletion navigation");
check(clubAccount.includes("/club/privacy") && coachAccount.includes("/coach/privacy") && sharedAccount.includes("/glow-zone/privacy"), "Club, Coach and Glow Zone account views link to their own privacy notices");
check(sharedAccount.includes("authApp") && sharedAccount.includes("authApps[authApp].privacyPath"), "shared account view selects the correct policy for native app context");
check(!/DEVELOPMENT_TEAM\s*=/.test(appSpecs.map(app => readFileSync(resolve(root, app.folder, `${app.project}.xcodeproj/project.pbxproj`), "utf8")).join("\n")), "no Team ID or signing identity is embedded in project settings");

const store = JSON.parse(readFileSync(resolve(root, "AppStoreConnect/apps.json"), "utf8"));
check(store.apps.length === 4 && store.apps.every((app, index) => app.bundleId === appSpecs[index].bundle), "App Store Connect draft lists all four distinct apps");
check(store.apps.every((app, index) => app.privacyPolicyUrl === `https://app.r12.live${appSpecs[index].privacy}`), "each app listing uses its app-specific privacy policy");
check(store.apps.every((app, index) => app.privacyChoicesUrl === `https://app.r12.live/account/delete?app=${["training", "club", "coach", "glow"][index]}`), "all listings expose their branded account-deletion choices route");
check(existsSync(resolve(root, "../app/account/delete/page.tsx")), "account-deletion choices route exists in the app");
check(store.apps.every(app => app.sku === null), "App Store Connect SKUs are left for the owner to choose");
check(store.supportUrl === null && store.apps.every(app => app.copyright === null), "support URL and per-app copyright are left for verified owner details");
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

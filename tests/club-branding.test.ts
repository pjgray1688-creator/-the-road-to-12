import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubTitle } from "../lib/club-metadata";

test("Club operations and member Android install identities remain separate", () => {
  const clubManifest = readFileSync(new URL("../app/club/manifest.webmanifest/route.ts", import.meta.url), "utf8");
  const memberManifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  const androidApps = readFileSync(new URL("../lib/android-apps.ts", import.meta.url), "utf8");
  assert.match(clubManifest, /manifestResponse\("club"\)/);
  assert.match(memberManifest, /webManifest\("r12"\)/); assert.doesNotMatch(memberManifest, /club-icon/);
  assert.match(androidApps, /startUrl: "\/club\/reception"/); assert.match(androidApps, /manifestPath: "\/club\/manifest\.webmanifest"/);
});

test("Club title architecture is generic and tenant-safe", () => {
  const layout = readFileSync(new URL("../app/club/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /R12 Club/); assert.doesNotMatch(layout, /Madhouse/);
});

test("Club tenant title helper uses the multiplication mark", () => {
  assert.equal(clubTitle("Shop", "Madhouse Gym"), "Shop · R12 × Madhouse Gym");
  assert.equal(clubTitle(), "R12 Club");
});

test("Club shared authentication uses the approved emblem and light presentation", () => {
  const hash = (path: string) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
  const authApps = readFileSync(new URL("../lib/auth-app.ts", import.meta.url), "utf8");
  const authBrand = readFileSync(new URL("../components/auth-brand.tsx", import.meta.url), "utf8");
  const account = readFileSync(new URL("../app/account/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.equal(hash("../public/brand/r12-club-emblem.png"), "c3260ddbad15a09d540b3e4e6bf0c4dbe3c69c4893ab18cd79274b25358d08ab");
  assert.match(authApps, /club: .*markSrc: "\/brand\/r12-club-emblem\.png"/);
  assert.match(authBrand, /app === "club" \? null : <span>\{brand\.name\}<\/span>/);
  assert.match(account, /`Sign in to \$\{authApps\[authApp\]\.name\}`/);
  assert.match(account, /signInWithPassword/);
  assert.match(account, /resetPasswordForEmail/);
  assert.match(account, /supabase\.auth\.signUp/);
  assert.match(styles, /\.auth-product-page-club\{[\s\S]*?background:#fff!important/);
  assert.match(styles, /\.auth-product-page-club > p:last-child\{display:none!important\}/);
  assert.match(styles, /\.auth-product-page-club :is\(a,button,input\):focus-visible/);
});

test("Club operations use the approved proportional Madhouse banner and light navigation", () => {
  const hash = createHash("sha256").update(readFileSync(new URL("../public/club-branding/madhouse-club-wide.png", import.meta.url))).digest("hex");
  const dashboard = readFileSync(new URL("../app/club/page.tsx", import.meta.url), "utf8");
  const bannerStyles = readFileSync(new URL("../components/club-operations.module.css", import.meta.url), "utf8");
  const nav = readFileSync(new URL("../components/club-shell.tsx", import.meta.url), "utf8");
  const navStyles = readFileSync(new URL("../components/club-shell.module.css", import.meta.url), "utf8");

  assert.equal(hash, "d757dbff2a48cd52a5a56b10026c1b81156f06586e43b64dc57e26382c51d469");
  assert.match(dashboard, /src="\/club-branding\/madhouse-club-wide\.png"/);
  assert.match(bannerStyles, /aspect-ratio:1717\/916/);
  assert.match(bannerStyles, /object-position:center/);
  assert.match(navStyles, /Final light Club operations treatment/);
  assert.match(navStyles, /background:linear-gradient\(135deg,#fff/);
  assert.match(nav, /Choose organisation/);
  assert.match(nav, /Choose operational venue/);
});

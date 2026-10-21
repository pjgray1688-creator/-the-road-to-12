import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("R12 app metadata uses the canonical raster mark instead of the invented SVG wordmark", () => {
  const metadata = fs.readFileSync("app/layout.tsx", "utf8");
  const brand = fs.readFileSync("lib/brand.ts", "utf8");
  const manifest = fs.readFileSync("lib/android-apps.ts", "utf8");
  const clubManifest = fs.readFileSync("app/club/manifest.webmanifest/route.ts", "utf8");

  assert.match(brand, /markSrc: "\/r12-app-assets\/icon-192\.png"/);
  assert.match(metadata, /r12-app-assets\/favicon\.ico/);
  assert.match(metadata, /r12-app-assets\/favicon-16\.png/);
  assert.match(metadata, /r12-app-assets\/favicon-32\.png/);
  assert.match(metadata, /r12-app-assets\/favicon-48\.png/);
  assert.match(metadata, /r12-app-assets\/apple-touch-icon\.png/);
  assert.doesNotMatch(metadata, /icon\.svg/);
  assert.match(manifest, /r12-app-assets\/icon-192\.png/);
  assert.match(manifest, /r12-app-assets\/icon-512\.png/);
  assert.match(clubManifest, /manifestResponse\("club"\)/);
  assert.match(manifest, /club-icon-192\.png/);
  assert.match(manifest, /club-icon-512\.png/);
});

test("Coach shell uses the shared R12 mark and current typography tokens without member navigation", () => {
  const shell = fs.readFileSync("components/coach-product-shell.tsx", "utf8");
  const shellStyles = fs.readFileSync("components/coach-product-shell.module.css", "utf8");
  const navStyles = fs.readFileSync("components/coach-navigation.module.css", "utf8");
  const nav = fs.readFileSync("components/coach-navigation.tsx", "utf8");
  const memberNav = fs.readFileSync("components/app-nav.tsx", "utf8");

  assert.match(shell, /src=\{brand\.markSrc\}/);
  assert.match(shell, /className=\{styles\.productLabel\}>Coach</);
  assert.doesNotMatch(shell, /<span>R12<\/span><small>COACH<\/small>/);
  assert.match(shellStyles, /font-family:inherit/);
  assert.match(shellStyles, /var\(--surface-0/);
  assert.match(navStyles, /var\(--text-secondary/);
  assert.match(nav, /href: "\/coach\/account", label: "Account"/);
  assert.doesNotMatch(shell, /AppNav|app-nav/);
  assert.match(memberNav, /href: "\/", label: "Home"/);
});

test("service worker no longer caches stale SVG icons", () => {
  const worker = fs.readFileSync("public/sw.js", "utf8");
  assert.match(worker, /r12-app-assets\\\/\[a-z0-9-\]\+\\\.\(\?:ico\|png\)/);
  assert.doesNotMatch(worker, /r12-app-assets.*svg/);
});

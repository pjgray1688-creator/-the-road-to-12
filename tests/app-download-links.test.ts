import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_DOWNLOAD_LINKS, PERMANENT_QR_DESTINATIONS, appOpenUrl, detectDownloadPlatform, isAppDownloadSlug } from "../lib/app-download-links";
import { accessQrMatrix } from "../lib/qr-code";

test("all four permanent smart QR paths map to the supplied official store listings", () => {
  assert.deepEqual(Object.keys(APP_DOWNLOAD_LINKS), ["training", "club", "coach", "glow-zone"]);
  assert.deepEqual(Object.values(APP_DOWNLOAD_LINKS).map(app => app.qrPath), ["/go/training", "/go/club", "/go/coach", "/go/glow-zone"]);
  assert.deepEqual(Object.values(PERMANENT_QR_DESTINATIONS), [
    "https://app.r12.live/go/training", "https://app.r12.live/go/club", "https://app.r12.live/go/coach", "https://app.r12.live/go/glow-zone",
  ]);
  assert.equal(APP_DOWNLOAD_LINKS.training.apple, "https://apps.apple.com/us/app/r12/id6826376621");
  assert.equal(APP_DOWNLOAD_LINKS.training.googlePlay, "https://play.google.com/store/apps/details?id=live.r12.training");
  assert.equal(APP_DOWNLOAD_LINKS.club.apple, "https://apps.apple.com/us/app/r12-club/id6826550359");
  assert.equal(APP_DOWNLOAD_LINKS.club.googlePlay, "https://play.google.com/store/apps/details?id=live.r12.club");
  assert.equal(APP_DOWNLOAD_LINKS.coach.apple, "https://apps.apple.com/us/app/r12-coach/id6826687128");
  assert.equal(APP_DOWNLOAD_LINKS.coach.googlePlay, "https://play.google.com/store/apps/details?id=live.r12.coach");
  assert.equal(APP_DOWNLOAD_LINKS["glow-zone"].apple, "https://apps.apple.com/us/app/glow-zone/id6826693241");
  assert.equal(APP_DOWNLOAD_LINKS["glow-zone"].googlePlay, "https://play.google.com/store/apps/details?id=live.r12.glowzone");
});

test("platform detection supports iOS, Android, desktop and unknown user agents", () => {
  assert.equal(detectDownloadPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(detectDownloadPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)"), "android");
  assert.equal(detectDownloadPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
  assert.equal(detectDownloadPlatform("R12-Test-Device/1.0"), "unknown");
  assert.equal(detectDownloadPlatform(null), "unknown");
});

test("Open App links only target the fixed existing app paths; arbitrary slugs are rejected", () => {
  assert.equal(appOpenUrl("training"), "https://app.r12.live/training");
  assert.equal(appOpenUrl("club"), "https://app.r12.live/club");
  assert.equal(appOpenUrl("coach"), "https://app.r12.live/coach");
  assert.equal(appOpenUrl("glow-zone"), "https://app.r12.live/glow-zone");
  assert.equal(isAppDownloadSlug("https://attacker.example"), false);
  assert.equal(isAppDownloadSlug("unknown"), false);
});

test("generated print QR assets use only their permanent R12 URL destinations", () => {
  for (const slug of Object.keys(APP_DOWNLOAD_LINKS) as Array<keyof typeof APP_DOWNLOAD_LINKS>) {
    const target = PERMANENT_QR_DESTINATIONS[slug];
    assert.equal(accessQrMatrix(target).length, 33);
    const svg = readFileSync(`public/app-download-qr/${slug}.svg`, "utf8");
    const png = readFileSync(`public/app-download-qr/${slug}.png`);
    assert.match(svg, /<svg[^>]+width="984" height="984"/);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(!svg.includes("apps.apple.com") && !svg.includes("play.google.com"));
  }
});

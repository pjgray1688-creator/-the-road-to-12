import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("ios/Shared/RouteWebScreen.swift", "utf8");
const injection = source.match(/let source = """([\s\S]*?)"""/)?.[1];
assert.ok(injection);

test("native presentation marker is restricted to first-party main app documents", () => {
  for (const origin of ["https://app.r12.live", "https://example.com", "https://app.r12.live.example.com"]) {
    const document = { documentElement: { dataset: {} as Record<string, string>, appendChild() {} }, addEventListener() {}, getElementById() { return null; }, createElement() { return {}; } };
    const window = {} as Record<string, unknown>;
    vm.runInNewContext(injection, { location: { origin }, document, window });
    assert.equal(window.__R12_MEMBER_IOS__, origin === "https://app.r12.live" ? true : undefined);
    assert.equal(document.documentElement.dataset.r12Shell, origin === "https://app.r12.live" ? "member-ios" : undefined);
  }
});

test("native marker recovers when document root is unavailable at document start", () => {
  let ready: (() => void) | undefined;
  const document: { documentElement?: { dataset: Record<string, string>; appendChild: () => void }; getElementById: () => null; createElement: () => object; addEventListener: (name: string, callback: () => void) => void } = {
    getElementById() { return null; }, createElement() { return {}; },
    addEventListener(name, callback) { assert.equal(name, "DOMContentLoaded"); ready = callback; },
  };
  vm.runInNewContext(injection, { location: { origin: "https://app.r12.live" }, document, window: {} });
  document.documentElement = { dataset: {}, appendChild() {} };
  ready?.();
  assert.equal(document.documentElement.dataset.r12Shell, "member-ios");
});

test("ordinary browser navigation remains available and only tagged member navigation is hidden", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /html\[data-r12-shell="member-ios"\] \[data-r12-web-navigation="member"\]\{display:none!important\}/);
  const nav = readFileSync("components/app-nav.tsx", "utf8");
  assert.match(nav, /data-r12-web-navigation="member"/);
  assert.match(nav, /label: "Coach"/);
});

test("Home reports a failed authoritative load and a successful retry clears it", async () => {
  const home = readFileSync("components/home-shell.tsx", "utf8");
  const body = home.match(/const hydrateServer = useCallback\(async \(\) => \{([\s\S]*?)\n  \},/)?.[1];
  assert.ok(body);
  let error = "";
  let serverReady = false;
  let fail = true;
  const context = {
    setLoadError(value: string) { error = value; },
    async fetchServerWorkouts() { if (fail) throw new Error("unavailable"); return []; },
    serverResolved: false, timezone: "Europe/London",
    async importLocalWorkouts() {}, cacheServerWorkouts() {}, setServerWorkouts() {},
    setServerResolved(value: boolean) { serverReady = value; },
    resolveToday() { return {}; }, activeWeek() { return {}; }, completedToday() {},
    setCompleted() {}, setActive() {}, setResolved() {},
  };
  await vm.runInNewContext(`(async () => {${body}})()`, context);
  assert.equal(serverReady, false);
  assert.match(error, /temporarily unavailable/);
  fail = false;
  await vm.runInNewContext(`(async () => {${body}})()`, context);
  assert.equal(serverReady, true);
  assert.equal(error, "");
});

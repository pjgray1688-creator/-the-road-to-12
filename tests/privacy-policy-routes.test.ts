import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  ["app/privacy/page.tsx", 'app="training"', 'canonical: "/privacy"', "/privacy"],
  ["app/club/privacy/page.tsx", 'app="club"', 'canonical: "/club/privacy"', "/club/privacy"],
  ["app/coach/privacy/page.tsx", 'app="coach"', 'canonical: "/coach/privacy"', "/coach/privacy"],
  ["app/glow-zone/privacy/page.tsx", 'app="glow"', 'canonical: "/glow-zone/privacy"', "/glow-zone/privacy"],
] as const;

test("each app has its own canonical privacy policy route", () => {
  for (const [file, app, canonical] of routes) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(app), `${file} must select its app-specific policy`);
    assert.ok(source.includes(canonical), `${file} must declare its canonical path`);
  }
  const footer = readFileSync("components/site-footer.tsx", "utf8");
  for (const [, , , path] of routes) {
    assert.ok(footer.includes(`href="${path}"`), `site footer must link to ${path}`);
  }
});

test("privacy policy preserves verified operator facts and identifies unresolved roles", () => {
  const source = readFileSync("components/privacy-policy.tsx", "utf8");
  assert.match(source, /R12 Digital Ltd operates the R12/);
  assert.match(source, /controller, processor or joint controller/);
  assert.match(source, /Madhouse Products and Services Limited/);
  assert.match(source, /Madhouse Franchise Limited \(company number 17383077\)/);
  assert.match(source, /Madhouse Products and Services Limited \(company number 17383213\)/);
  assert.match(source, /contact@madhousegym\.online/);
});

test("privacy policy describes the account-deletion request route without promising automatic deletion", () => {
  const source = readFileSync("components/privacy-policy.tsx", "utf8");
  const route = readFileSync("app/account/delete/page.tsx", "utf8");

  assert.match(source, /account-deletion page/);
  assert.match(source, /\/account\/delete\?app=/);
  assert.match(source, /Requests are reviewed before eligible personal data/);
  assert.match(source, /account deletion does not automatically cancel it/);
  assert.ok(route.includes("AccountDeletion"), "account-deletion route must render its request flow");
});

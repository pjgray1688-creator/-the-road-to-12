import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  ["app/privacy/page.tsx", 'app="training"', 'canonical: "/privacy"', "/privacy"],
  ["app/(public-club)/club/privacy/page.tsx", "<ClubPrivacyPolicy", 'canonical: "/club/privacy"', "/club/privacy"],
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

test("R12 notice describes the implemented request process without promising automatic erasure", () => {
  const source = readFileSync("components/r12-privacy-policy.tsx", "utf8");
  const shared = readFileSync("components/privacy-policy.tsx", "utf8");
  assert.match(shared, /if \(app === "training"\) return <R12PrivacyPolicy/);
  assert.match(source, /href="\/account\/delete"/);
  assert.match(source, /rather than automatically erasing your account/);
  assert.match(source, /one calendar month/);
  assert.match(source, /does not itself cancel a gym membership/);
  assert.match(source, /retention requirements/);
  assert.doesNotMatch(source, /repository|pending confirmation|before publication|no verified public|does not provide an in-app/i);
});

test("public support provides the approved mailbox and privacy, terms and deletion routes", () => {
  const support = readFileSync("app/support/page.tsx", "utf8");
  const legal = readFileSync("lib/legal.ts", "utf8");
  assert.match(legal, /"peter@r12\.live"/);
  assert.match(support, /mailto:\$\{privacyContactEmail\}/);
  for (const path of ["/privacy", "/terms", "/account/delete"]) assert.ok(support.includes(`href="${path}"`));
  assert.doesNotMatch(support, /serverSupabase|browserSupabase|<form|fetch\(/);
  assert.match(support, /If you cannot sign in/);
  assert.ok(readFileSync("components/site-footer.tsx", "utf8").includes('href="/support"'));
});

test("R12 distinguishes service responsibility without asserting unverified processor contracts", () => {
  const source = readFileSync("components/r12-privacy-policy.tsx", "utf8");
  assert.match(source, /R12 Digital Ltd operates R12/);
  assert.match(source, /A participating gym or coach is responsible for the membership, services and records it manages/);
  assert.match(source, /Access to shared records depends on your connection/);
  assert.doesNotMatch(source, /on the organisation&apos;s behalf|joint controller|executed.*agreement/i);
});

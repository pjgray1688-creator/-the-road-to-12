import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("components/club-shell.tsx", "utf8");
const shellCss = readFileSync("components/club-shell.module.css", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const dashboard = readFileSync("app/club/page.tsx", "utf8");
const classesPage = readFileSync("app/club/classes/page.tsx", "utf8");
const sunbedsPage = readFileSync("app/club/sunbeds/page.tsx", "utf8");
const classesCss = readFileSync("app/club/classes/classes.module.css", "utf8");
const scheduleCss = readFileSync("components/club-schedule-calendar.module.css", "utf8");
const glowHours = readFileSync("components/glow-zone-opening-hours.tsx", "utf8");

function clubPageSources(directory = "app/club"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? clubPageSources(path) : /\.tsx?$/.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
}

test("Club mobile menu uses one vertical link list, separate selectors, close and route-change handling", () => {
  assert.match(shell, /role="dialog" aria-modal="true"/);
  assert.match(shell, /aria-label="Close navigation"/);
  assert.match(shell, /window\.addEventListener\("keydown",handleMenuKey\)/);
  assert.match(shell, /event\.key==="Escape"/);
  assert.match(shell, /event\.shiftKey&&document\.activeElement===first/);
  assert.match(shell, /requestAnimationFrame\(\(\)=>menuButtonRef\.current\?\.focus\(\)\)/);
  assert.match(shell, /const menuVisible=mobileOpen&&menuPath===pathname/);
  assert.match(shell, /onClick=\{closeMenu\}/);
  assert.match(shell, /<section aria-label="Venue selector"><h2>Venue<\/h2>\{renderVenue\(true\)\}<\/section>/);
  assert.match(shellCss, /\.mobileLinks \{ display: grid; grid-template-columns: minmax\(0,1fr\)/);
  assert.match(shellCss, /\.mobileMenu \{ position: fixed;[^}]*height: 100dvh/);
  assert.match(shellCss, /safe-area-inset-top/);
  assert.match(shellCss, /safe-area-inset-bottom/);
});

test("Club navigation keeps role-based destinations and organisation-scoped venue selection", () => {
  assert.match(shell, /const operational = \["trainer", "gym_staff", "gym_admin", "owner"\]/);
  assert.match(shell, /const admin = \["gym_admin", "owner"\]/);
  assert.match(shell, /\[\["Classes", `\/club\/classes/);
  assert.match(shell, /\["Membership payments", `\/club\/membership-billing/);
  assert.match(shell, /org=\$\{encodeURIComponent\(organisation\.id\)\}/);
  assert.match(shell, /Choose operational venue/);
});

test("Club pages receive safe-area, clipped-heading and narrow-screen layout rules without changing workflows", () => {
  assert.match(globals, /\.club-page\{[^}]*padding-top:calc\(10px \+ env\(safe-area-inset-top\)\)/);
  assert.match(globals, /\.club-page \.page-header h1\{[^}]*line-height:1\.12/);
  assert.match(globals, /@media\(max-width:760px\)[\s\S]*html:has\(\.club-page\),body:has\(\.club-page\)\{[^}]*overflow-x:clip/);
  assert.match(globals, /\.club-page \.club-detail-row\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:5px\}/);
  assert.doesNotMatch(dashboard, /eyebrow="R12 CLUB · OPERATIONS"/);
  assert.match(dashboard, /ClubMemberOnboarding/);
  assert.match(dashboard, /ClubSectionNav/);
});

test("Club page headers omit redundant section eyebrows", () => {
  for (const source of clubPageSources()) assert.doesNotMatch(source, /<PageHeader[^>]*eyebrow="R12 CLUB(?: ·|\")/);
});

test("class timetable defaults to six upcoming sessions and can browse historical weeks", () => {
  const source = readFileSync("components/club-classes.tsx", "utf8");
  assert.match(source, /upcomingClassSessions\(filteredSessions\)/);
  assert.match(source, /classSessionsInLondonWeek\(filteredSessions, weekDate\)/);
  assert.match(source, /Browse week \/ history/);
  assert.match(classesPage, /memberView \? session\.status === "scheduled"/);
  assert.match(classesPage, /const availabilitySessions = visibleSessions\.filter/);
  assert.match(classesCss, /@media\(max-width:360px\)/);
  assert.match(classesCss, /@media\(max-width:720px\)/);
});

test("schedule, Glow Zone and mobile page rules stay within the viewport", () => {
  assert.match(scheduleCss, /workspace:not\(\.coachMode\).*dateStrip/);
  assert.match(scheduleCss, /@media\(max-width:360px\)/);
  assert.match(glowHours, /<details className="glow-hours">/);
  assert.match(glowHours, /<summary>/);
  assert.ok(sunbedsPage.indexOf("<ClubSunbedOperations") < sunbedsPage.indexOf("<GlowZoneOpeningHours"));
  assert.match(globals, /@media\(max-width:380px\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Coach clients page keeps roster tools and removes the redundant diary CTA and explanatory hero", () => {
  const workspace = read("components/coach-workspace.tsx");
  const dashboard = read("components/coach-dashboard.tsx");
  assert.match(workspace, /className="coach-visually-hidden">Clients<\/h1>/);
  assert.doesNotMatch(workspace, /<span className="eyebrow">CLIENTS<\/span><h1>/);
  assert.match(workspace, /Add client/);
  assert.doesNotMatch(workspace, /View diary|Open Diary/);
  for (const usefulTool of ["Search your clients", "Primary", "Cover", "Pending", "Recent activity", "NEEDS ATTENTION"]) {
    assert.ok((workspace + dashboard).toLowerCase().includes(usefulTool.toLowerCase()), `${usefulTool} remains available`);
  }
});

test("top-level plan pages use a compact searchable linked-client selector and keep authorised destinations", () => {
  const destinations = read("components/coach-client-destinations.tsx");
  assert.match(destinations, /Find a client/);
  assert.match(destinations, /coach-visually-hidden">\{title\}<\/h1>/);
  assert.doesNotMatch(destinations, /CLIENT PLANS|<h1>\{title\}/);
  assert.match(destinations, /coach\?client=.*section=programme/);
  assert.match(destinations, /coach\/nutrition\?client=/);
  assert.doesNotMatch(destinations, /Choose a client programme|Choose a client nutrition plan|Open clients/);
  assert.match(destinations, /No linked clients yet/);
});

test("client workspace has compact Overview, Programme, Nutrition, Sessions and Progress navigation", () => {
  const navigation = read("components/coach-client-section-nav.tsx");
  const workspace = read("components/coach-client-workspace.tsx");
  const nutrition = read("app/coach/nutrition/page.tsx");
  for (const label of ["Overview", "Programme", "Nutrition", "Sessions", "Progress"]) assert.match(navigation, new RegExp(`label: "${label}"`));
  assert.match(workspace, /CoachClientSectionNav/);
  assert.match(workspace, /onClick=\{\(\) => onSectionChange\("checkins"\)\}/);
  assert.match(nutrition, /coach_list_clients/);
  assert.match(nutrition, /authorizedClient/);
  assert.match(nutrition, /CoachNutrition clientUserId=\{client\} clientName=/);
});

test("client nutrition navigation remains tied to an authorized client and uses the existing nutrition RPC", () => {
  const route = read("app/coach/nutrition/page.tsx");
  const component = read("components/coach-nutrition.tsx");
  assert.match(route, /nutrition_get_coach_view/);
  assert.match(route, /coach_list_clients/);
  assert.match(route, /if \(!authorizedClient\)/);
  assert.match(component, /coach-visually-hidden/);
  assert.doesNotMatch(component, /coach-nutrition-heading|<h1>Nutrition/);
  assert.match(component, /CoachClientSectionNav clientUserId=\{clientUserId\} active="nutrition"/);
});

test("Coach account presents a compact settings summary and retains switch/sign-out controls", () => {
  const page = read("app/coach/account/page.tsx");
  const css = read("app/coach/account/page.module.css");
  assert.match(page, /coach-visually-hidden">Account<\/h1>/);
  assert.match(page, /Coach access/);
  assert.match(page, /Open R12/);
  assert.match(page, /CoachAccountActions/);
  assert.match(css, /@media\(max-width:430px\)/);
});

test("Coach section titles are visually removed while semantic headings and page content remain", () => {
  const clients = read("components/coach-workspace.tsx");
  const diaryPage = read("app/coach/diary/page.tsx");
  const diaryCalendar = read("components/club-schedule-calendar.tsx");
  const programmeAndNutrition = read("components/coach-client-destinations.tsx");
  const nutrition = read("components/coach-nutrition.tsx");
  const account = read("app/coach/account/page.tsx");
  assert.match(clients, /coach-visually-hidden">Clients<\/h1>/);
  assert.match(diaryPage, /coach-visually-hidden">Diary<\/h1>/);
  assert.doesNotMatch(diaryCalendar, /COACH DIARY · MADHOUSE|coachMode\?"Diary"/);
  assert.match(programmeAndNutrition, /coach-visually-hidden">\{title\}<\/h1>/);
  assert.doesNotMatch(programmeAndNutrition, /CLIENT PLANS|<h1>\{title\}/);
  assert.match(nutrition, /coach-visually-hidden/);
  assert.doesNotMatch(nutrition, /coach-nutrition-heading|<h1>Nutrition/);
  assert.match(account, /coach-visually-hidden">Account<\/h1>/);
  assert.doesNotMatch(account, /<span className="eyebrow">ACCOUNT<\/span>/);
});

test("Coach visual cleanup remains responsive and scoped away from Member and Club surfaces", () => {
  const shellCss = read("components/coach-product-shell.module.css");
  const diaryCss = read("components/club-schedule-calendar.module.css");
  const shell = read("components/coach-product-shell.tsx");
  assert.match(shell, /CoachNavigation/);
  assert.match(shellCss, /@media\(max-width:540px\)/);
  assert.match(diaryCss, /@media\(max-width:720px\)/);
  assert.match(diaryCss, /@media\(max-width:360px\)/);
  assert.match(shellCss, /\.content :global\(\.coach-shell/);
  assert.match(shellCss, /\.content :global\(\.module-page/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/club-member-classes.tsx", "utf8");
const memberRoute = readFileSync("app/member-hub/classes/page.tsx", "utf8");
const clubRoute = readFileSync("app/club/classes/page.tsx", "utf8");
const editor = readFileSync("components/manual-programme-editor.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("member timetable uses London week navigation and opens real session details", () => {
  assert.match(component, /timeZone: "Europe\/London"/);
  assert.match(component, /member-class-date-strip/);
  assert.match(component, /aria-pressed=\{selectedDate === key\}/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /instructorName/);
  assert.match(component, /spacesRemaining/);
  assert.match(component, /Up to 60 min/);
  assert.doesNotMatch(component, /startsAt\)}–\{sessionTime\(selectedSession\.endsAt/);
  assert.match(memberRoute, /repository\.listLocations/);
  assert.match(memberRoute, /repository\.listClassTypes/);
  assert.match(memberRoute, /club_madhouse_class_commercial_config/);
  assert.match(memberRoute, /club_list_my_class_credits/);
  assert.match(clubRoute, /locations=\{locations\} classTypes=\{classTypes\}/);
});

test("booking fails closed when lookup is missing and customer copy stays payment-method neutral", () => {
  assert.match(component, /const availabilityUnavailable = !selectedAvailability/);
  assert.match(component, /disabled=\{demoMode \|\| pending \|\| availabilityUnavailable \|\| full/);
  assert.match(component, /PAYG pricing is temporarily unavailable/);
  assert.match(component, /inFlight\.current\.has\(sessionId\)/);
  assert.match(component, /Pay by card/);
  assert.match(component, /Cash on arrival/);
  assert.doesNotMatch(component, /Stripe|Cash · £10 due|Cash £10 due/);
  assert.match(component, /£10 PAYG/);
});

test("member class credits and included entitlement render only when supplied and available", () => {
  assert.match(component, /classCredits \? <section className="member-class-credits"/);
  assert.match(component, /selectedEntitlement\?\.status === "available"/);
  assert.doesNotMatch(component, /Included class entitlement unavailable/);
});

test("manual editor keeps existing searchable and editable workflow with safe mobile layout rules", () => {
  for (const token of ["Search the exercise library", "Add a custom exercise", "Move earlier", "Move later", "Save and activate programme"]) assert.ok(editor.includes(token));
  assert.match(editor, /role="tablist"/);
  assert.match(css, /\.manual-programme-page[^\n]*overflow-x:clip/);
  assert.match(css, /\.manual-programme-page \.page-header h1[^\n]*overflow-wrap:anywhere/);
  assert.match(css, /\.manual-programme-page select[^\n]*background-color:var\(--panel2\)/);
  assert.match(css, /padding-bottom:calc\(112px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)/);
});

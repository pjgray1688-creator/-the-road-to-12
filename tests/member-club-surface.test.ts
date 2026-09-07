import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("Account exposes My Club as the member umbrella", () => {
  const source = fs.readFileSync("app/account/page.tsx", "utf8");
  assert.match(source, /label="My Gym"/);
  assert.match(source, /href="\/member-hub"/);
});

test("member Club home keeps member-only surfaces and avoids operational records", () => {
  const source = fs.readFileSync("components/club-member-home.tsx", "utf8");
  assert.match(source, /MEMBERSHIP & ACCESS/);
  assert.match(source, /MADHOUSE BALANCE/);
  assert.match(source, /CLASSES/);
  assert.match(source, /ORDERS & RECEIPTS/);
  assert.doesNotMatch(source, /club-detail-row.*memberEmail|staff notes|service-role/i);
});

test("member class booking uses server-authorised repository actions", () => {
  const actions = fs.readFileSync("app/club/classes/member-actions.ts", "utf8");
  const component = fs.readFileSync("components/club-member-classes.tsx", "utf8");
  assert.match(actions, /resolveClubOrganisationContext/);
  assert.match(actions, /getMemberOperationalProfile/);
  assert.match(actions, /createClassBooking/);
  assert.match(actions, /cancelClassBooking/);
  assert.match(component, /Book class/);
  assert.match(component, /Cancel/);
  assert.match(component, /aria-live|role="alert"/);
});

test("member classes expose aggregate availability, not attendee identities", () => {
  const page = fs.readFileSync("app/club/classes/page.tsx", "utf8");
  assert.match(page, /getClassAvailability/);
  assert.doesNotMatch(page, /members=.*bookings|attendee|attendees/i);
});

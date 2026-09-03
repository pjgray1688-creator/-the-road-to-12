import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("member onboarding is repository-backed and avoids fabricated accounts", () => {
  const component = read("components/club-member-onboarding.tsx");
  const actions = read("app/club/members/actions.ts");
  assert.match(component, /Find an existing customer|Existing person/);
  assert.match(component, /People without an R12 account are recorded as guests/);
  assert.match(component, /assignMembershipAction/);
  assert.match(actions, /createCustomer/);
  assert.match(actions, /club_assign_product|assignProduct/);
  assert.match(actions, /gym_admin.*owner/);
});

test("membership assignment uses persisted product benefits and preserves history", () => {
  const component = read("components/club-membership-assignment.tsx");
  const actions = read("app/club/members/actions.ts");
  assert.match(component, /Benefits are applied from the saved product definition/);
  assert.match(component, /Existing history is kept/);
  assert.match(actions, /kind === "membership"/);
  assert.match(actions, /source: "staff_assignment"/);
});

test("membership directory loads onboarding dependencies in one parallel read", () => {
  const page = read("app/club/members/page.tsx");
  assert.match(page, /Promise\.all\(\[context\.repository\.listMemberSummaries/);
  assert.match(page, /ClubMemberOnboarding/);
});

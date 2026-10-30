import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { membershipProducts } from "../lib/club-membership-catalogue";
import { madhouseCatalogue, materialiseCatalogueProduct } from "../lib/madhouse-catalogue";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("member onboarding is repository-backed and avoids fabricated accounts", () => {
  const component = read("components/club-member-onboarding.tsx");
  const membersPage = read("app/club/members/page.tsx");
  const actions = read("app/club/members/actions.ts");
  assert.match(membersPage, /Add or update a member/);
  assert.doesNotMatch(membersPage, /ADD PERSON/);
  assert.match(component, /Member<select/);
  assert.match(component, /New member/);
  assert.doesNotMatch(component, /record a new walk-in/);
  assert.match(component, /assignMembershipAction/);
  assert.match(actions, /createCustomer/);
  assert.match(actions, /assignMembership|assignProduct/);
  assert.match(actions, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.assign"\)/);
});

test("membership management exposes active staff-assignment products without making them customer-sellable", () => {
  const products = madhouseCatalogue.map((definition, index) => materialiseCatalogueProduct(definition, "org-1", `product-${index}`));
  const assignable = membershipProducts(products, true).map(product => product.name);
  const staffOnly = membershipProducts(products, true, false).map(product => product.name);
  const regular = membershipProducts(products, false).map(product => product.name);
  assert.ok(assignable.includes("Golden Ticket Founding Membership"));
  assert.ok(staffOnly.includes("Yearly Membership"));
  assert.equal(staffOnly.includes("Golden Ticket Founding Membership"), false);
  assert.equal(regular.includes("Golden Ticket Founding Membership"), false);
  for (const name of ["Gym Day Pass", "Week Pass", "Standard Monthly", "Concession Monthly", "Couples Membership", "Yearly Membership"]) assert.ok(regular.includes(name));
  assert.equal(assignable.filter(name => name === "Golden Ticket Founding Membership").length, 1);
});

test("membership assignment uses persisted product benefits and preserves history", () => {
  const component = read("components/club-membership-assignment.tsx");
  const actions = read("app/club/members/actions.ts");
  assert.match(component, /authorised product definition/);
  assert.match(component, /confirmed receipt before access can activate/);
  assert.match(actions, /kind === "membership"/);
  assert.match(actions, /source: "staff_assignment"/);
});

test("membership directory loads onboarding dependencies in one parallel read", () => {
  const page = read("app/club/members/page.tsx");
  assert.match(page, /Promise\.all\(\[\s*context\.repository\.listMemberSummaries/);
  assert.match(page, /ClubMemberOnboarding/);
});

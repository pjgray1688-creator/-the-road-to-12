import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { madhouseCatalogue, madhouseMembershipRules, membershipRuleSummary, membershipSupportsAdditionalPerson } from "../lib/madhouse-catalogue";

const compatibilitySql = readFileSync("supabase/deployment/2027-01-24-production-catalogue-compatibility.sql", "utf8");
const serviceSeedSql = readFileSync("supabase/deployment/2027-01-24-madhouse-service-package-seed.sql", "utf8");
const joinPage = readFileSync("app/join/[clubSlug]/page.tsx", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const household = readFileSync("components/club-membership-household.tsx", "utf8");
const eligibility = readFileSync("components/club-membership-eligibility.tsx", "utf8");
const memberActions = readFileSync("app/club/members/actions.ts", "utf8");

test("public catalogue mirrors the six confirmed production memberships", () => {
  const memberships = madhouseCatalogue.filter(product => product.kind === "membership" && product.sellable);
  assert.deepEqual(Object.fromEntries(memberships.map(product => [product.name, product.priceMinor])), {
    "Gym Day Pass": 500,
    "Week Pass": 1200,
    "Standard Monthly": 2700,
    "Concession Monthly": 2200,
    "Couples Membership": 4500,
    "Yearly Membership": 25000,
  });
  assert.match(joinPage, /membershipRuleSummary/);
  assert.match(joinForm, /selectedProduct\.terms/);
});

test("membership rules preserve the production catalogue and household limits", () => {
  assert.equal(madhouseMembershipRules["Off Peak"], undefined);
  assert.match(membershipRuleSummary("Standard Monthly"), /both Madhouse gyms/i);
  assert.equal(membershipSupportsAdditionalPerson("Couples Membership"), true);
  assert.equal(membershipSupportsAdditionalPerson("Family Membership"), true);
  assert.equal(membershipSupportsAdditionalPerson("Standard Monthly"), false);
  assert.match(household, /if \(!supportsAdditionalPerson\) return null/);
  assert.doesNotMatch(compatibilitySql, /Off Peak|membership_access_window_guard/);
  assert.doesNotMatch(compatibilitySql, /club_guard_membership_holder_limit/);
});

test("discount checkout fails closed until an authorised verification exists", () => {
  assert.equal(madhouseMembershipRules["Concession Monthly"].eligibilityVerificationRequired, true);
  assert.match(compatibilitySql, /club_membership_eligibility_verifications/);
  assert.match(compatibilitySql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'memberships\.assign'\)/);
  assert.match(compatibilitySql, /Membership eligibility must be verified before checkout/);
  assert.match(compatibilitySql, /status='approved'/);
  assert.match(eligibility, /Approve eligibility/);
  assert.match(memberActions, /club_verify_membership_eligibility/);
});

test("transformation and PT shop products use separate paid entitlements and Products & Services routing", () => {
  for (const [name, pt] of [["Transformation Bronze", 1], ["Transformation Silver", 2], ["Transformation Gold", 3]] as const) {
    const product = madhouseCatalogue.find(item => item.name === name)!;
    assert.equal(product.durationDays, 70);
    assert.equal(product.entitlements.some(item => item.entitlementKey === "gym_access"), false);
    assert.deepEqual(product.entitlements.find(item => item.entitlementKey === "pt_session_credit")?.allowance, { quantity: pt, period: "week" });
    assert.deepEqual(product.entitlements.find(item => item.entitlementKey === "included_class_credit")?.allowance, { quantity: 1, period: "week" });
  }
  const ptBlock = madhouseCatalogue.find(item => item.name === "10 PT Session Block")!;
  assert.deepEqual(ptBlock.entitlements[0].allowance, { quantity: 10, period: "block" });
  assert.equal(ptBlock.entitlements.some(item => item.entitlementKey === "nutrition"), false);
  for (const sku of ["MH-SVC-TRANS-BRONZE", "MH-SVC-TRANS-SILVER", "MH-SVC-TRANS-GOLD", "MH-SVC-PT-10"]) assert.match(serviceSeedSql, new RegExp(sku));
  assert.match(serviceSeedSql, /array\['pos','online'\]/);
  assert.match(serviceSeedSql, /'madhouse_products_services'/);
  assert.match(serviceSeedSql, /An active gym membership is required before buying a transformation package/);
  assert.match(serviceSeedSql, /new\.payment_status not in \('paid','waived'\)/);
  assert.match(serviceSeedSql, /'pt_session_credit',rule\.weekly_pt_quantity,'week'/);
  assert.match(serviceSeedSql, /'included_class_credit',rule\.weekly_class_quantity,'week'/);
});

test("production compatibility binds actual names without renaming or repricing memberships", () => {
  for (const name of ["Gym Day Pass", "Week Pass", "Standard Monthly", "Concession Monthly", "Couples Membership", "Yearly Membership"]) assert.match(compatibilitySql, new RegExp(name));
  assert.doesNotMatch(compatibilitySql, /update public\.club_products|insert into public\.club_products|set name=/i);
  assert.doesNotMatch(compatibilitySql, /Off Peak/);
  assert.match(compatibilitySql, /Yearly Membership',25000/);
});

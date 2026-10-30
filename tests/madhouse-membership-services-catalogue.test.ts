import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { madhouseCatalogue, madhouseMembershipRules, membershipRuleSummary, membershipSupportsAdditionalPerson } from "../lib/madhouse-catalogue";

const sql = readFileSync("supabase/migrations/2027-01-24-madhouse-membership-services-catalogue.sql", "utf8");
const joinPage = readFileSync("app/join/[clubSlug]/page.tsx", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const household = readFileSync("components/club-membership-household.tsx", "utf8");
const eligibility = readFileSync("components/club-membership-eligibility.tsx", "utf8");
const memberActions = readFileSync("app/club/members/actions.ts", "utf8");

test("public catalogue exposes exactly the seven approved memberships", () => {
  const memberships = madhouseCatalogue.filter(product => product.kind === "membership" && product.sellable);
  assert.deepEqual(Object.fromEntries(memberships.map(product => [product.name, product.priceMinor])), {
    "Day Pass": 500,
    "1 Week Pass": 1200,
    "Unlimited Gym": 2700,
    "Off Peak": 1499,
    "Unlimited Gym Discount": 2200,
    "Couples Membership": 4500,
    "Yearly Membership": 27500,
  });
  assert.match(joinPage, /membershipRuleSummary/);
  assert.match(joinForm, /selectedProduct\.terms/);
});

test("membership rules keep both-site access, Off Peak and household limits explicit", () => {
  assert.deepEqual(madhouseMembershipRules["Off Peak"].accessWindow, {
    timeZone: "Europe/London", weekdays: [1, 2, 3, 4, 5], opensAt: "10:00", closesAt: "15:00",
  });
  assert.match(membershipRuleSummary("Off Peak"), /Monday to Friday, 10am–3pm/);
  assert.match(membershipRuleSummary("Unlimited Gym"), /both Madhouse gyms/i);
  assert.equal(membershipSupportsAdditionalPerson("Couples Membership"), true);
  assert.equal(membershipSupportsAdditionalPerson("Family Membership"), true);
  assert.equal(membershipSupportsAdditionalPerson("Unlimited Gym"), false);
  assert.match(household, /if \(!supportsAdditionalPerson\) return null/);
  assert.match(sql, /maximum_holders integer[\s\S]+between 1 and 2/);
  assert.match(sql, /club_membership_holder_limit/);
  assert.match(sql, /membership_access_window_guard/);
  assert.match(sql, /extract\(isodow from p_at at time zone r\.access_timezone\)/);
});

test("discount checkout fails closed until an authorised verification exists", () => {
  assert.equal(madhouseMembershipRules["Unlimited Gym Discount"].eligibilityVerificationRequired, true);
  assert.match(sql, /club_membership_eligibility_verifications/);
  assert.match(sql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'memberships\.assign'\)/);
  assert.match(sql, /Membership eligibility must be verified before checkout/);
  assert.match(sql, /status='approved'/);
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
  for (const sku of ["MH-SVC-TRANS-BRONZE", "MH-SVC-TRANS-SILVER", "MH-SVC-TRANS-GOLD", "MH-SVC-PT-10"]) assert.match(sql, new RegExp(sku));
  assert.match(sql, /item\.description,'Services',true,false/);
  assert.match(sql, /array\['pos','online'\]/);
  assert.match(sql, /'madhouse_products_services'/);
  assert.match(sql, /An active gym membership is required before buying a transformation package/);
  assert.match(sql, /new\.payment_status not in \('paid','waived'\)/);
  assert.match(sql, /'pt_session_credit',rule\.weekly_pt_quantity,'week'/);
  assert.match(sql, /'included_class_credit',rule\.weekly_class_quantity,'week'/);
});

test("migration reconciles legacy catalogue names without deleting memberships or Golden Tickets", () => {
  for (const legacy of ["Gym Day Pass", "Week Pass", "Standard Monthly", "Concession Monthly", "Unlimited Gym Couple"]) assert.match(sql, new RegExp(legacy));
  assert.match(sql, /set name='Couples Membership'.*name='Unlimited Gym Couple'/s);
  assert.doesNotMatch(sql, /set name='Unlimited Gym Couple'.*name='Couples Membership'/s);
  assert.doesNotMatch(sql, /delete from public\.club_memberships/i);
  assert.doesNotMatch(sql, /Golden Ticket Founding Membership/);
  assert.match(sql, /on conflict\(organisation_id,sku\) do update/);
});

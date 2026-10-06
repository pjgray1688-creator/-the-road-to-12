import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clubCapabilities,
  fullManagementCapabilities,
  hasClubCapability,
  operationalStaffCapabilities,
  resolveClubCapabilities,
} from "@/lib/club-capabilities";

const migration = readFileSync("supabase/migrations/2026-11-16-club-staff-permission-model.sql", "utf8");
const staffPage = readFileSync("app/club/staff/page.tsx", "utf8");
const staffEditor = readFileSync("components/club-staff-manage-access.tsx", "utf8");
const staffActions = readFileSync("app/club/staff/actions.ts", "utf8");
const memberActions = readFileSync("app/club/members/actions.ts", "utf8");
const coachBoundary = readFileSync("supabase/migrations/2026-10-05-coach-staff-access-management.sql", "utf8");

test("owner and configured gym_admin receive the same full management package", () => {
  assert.deepEqual(fullManagementCapabilities, clubCapabilities);
  assert.deepEqual(resolveClubCapabilities("owner"), resolveClubCapabilities("gym_admin"));
  assert.equal(hasClubCapability("owner", "staff.permissions_manage"), true);
  assert.equal(hasClubCapability("gym_admin", "staff.permissions_manage"), true);
  for (const capability of ["refunds.approve", "cash.reconcile", "supplier.catalogue_manage", "commerce.pricing_manage", "finance.manage", "staff.work_review"]) {
    assert.equal(hasClubCapability("gym_admin", capability as never), true);
  }
});

test("trainer and gym staff receive ordinary operational work but not sensitive management", () => {
  assert.deepEqual(resolveClubCapabilities("trainer"), [...operationalStaffCapabilities]);
  assert.deepEqual(resolveClubCapabilities("gym_staff"), [...operationalStaffCapabilities]);
  for (const capability of ["members.create", "members.link_account", "memberships.assign", "payments.take", "payments.record_cash", "inventory.adjust", "commerce.stock_remove", "supplier.orders_manage", "supplier.receive", "commerce.collections_manage", "classes.manage", "services.manage", "induction.perform"]) {
    assert.equal(hasClubCapability("trainer", capability as never), true, capability);
  }
  for (const capability of ["staff.permissions_manage", "refunds.approve", "cash.reconcile", "supplier.catalogue_manage", "commerce.pricing_manage", "finance.view", "finance.manage", "finance.export", "staff.work_review"]) {
    assert.equal(hasClubCapability("trainer", capability as never), false, capability);
  }
  assert.deepEqual(resolveClubCapabilities("member"), []);
  assert.deepEqual(resolveClubCapabilities("guest"), []);
});

test("individual deny and safe allow overrides retain deny precedence", () => {
  assert.equal(hasClubCapability("trainer", "payments.take", [{ capability: "payments.take", decision: "deny" }]), false);
  assert.equal(hasClubCapability("trainer", "members.import", [{ capability: "members.import", decision: "allow" }]), true);
  assert.equal(hasClubCapability("trainer", "staff.permissions_manage", [{ capability: "staff.permissions_manage", decision: "allow" }]), false);
  assert.equal(hasClubCapability("member", "payments.take", [{ capability: "payments.take", decision: "allow" }]), false);
});

test("database evaluator is organisation-scoped, closed, and capability-authoritative", () => {
  assert.match(migration, /m\.organisation_id=p_organisation_id/);
  assert.match(migration, /m\.user_id=p_user_id/);
  assert.match(migration, /p_user_id=auth\.uid\(\)/);
  assert.match(migration, /m\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(migration, /not exists[\s\S]*decision='deny'/);
  assert.match(migration, /p_capability<>'staff\.permissions_manage'/);
  assert.match(migration, /not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
  assert.match(migration, /Managers cannot remove their own staff-management permission/);
  assert.match(migration, /p_role not in \('gym_staff','gym_admin','trainer'\)/);
});

test("management grants provision exact role packages and staff RPCs remain server-authorised", () => {
  assert.match(staffActions, /staffManager\(input\.organisationId\)/);
  assert.match(staffActions, /hasCapability\(context\.organisation\.id, user\.id, "staff\.permissions_manage"\)/);
  assert.match(staffActions, /p_capabilities: expected/);
  assert.match(migration, /expected:=public\.club_capabilities_for_role\(p_role\)/);
  assert.match(migration, /The role permission package is invalid/);
  assert.doesNotMatch(staffActions, /\["owner", "gym_admin"\]\.includes/);
});

test("operational membership and service boundaries use capabilities at server and database layers", () => {
  assert.doesNotMatch(memberActions, /\["gym_admin", "owner"\]\.includes\(context\.role\)/);
  assert.match(memberActions, /"memberships\.assign"/);
  assert.match(memberActions, /"members\.link_account"/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'memberships\.assign'\)/);
  assert.match(migration, /club_capability_allowed\(c\.organisation_id,auth\.uid\(\),'members\.link_account'\)/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'services\.manage'\)/);
});

test("Coach access remains an explicit organisation permission, independent of Club role", () => {
  const canCoach = (role: string, explicitOrganisationGrant: boolean) =>
    ["owner", "gym_admin", "trainer"].includes(role) && explicitOrganisationGrant;
  assert.equal(canCoach("gym_admin", false), false, "Shan-style manager has no implied Coach access");
  assert.equal(canCoach("owner", true), true, "Keenan-style explicit grant works");
  assert.equal(canCoach("gym_admin", true), true, "Peter-style explicit grant works");
  assert.equal(canCoach("trainer", true), true, "trainer/PT explicit grant works");
  assert.equal(canCoach("gym_staff", false), false);
  assert.equal(canCoach("member", false), false);
  assert.match(coachBoundary, /where p\.organisation_id=p_organisation_id/);
  assert.match(coachBoundary, /p\.active/);
  assert.match(coachBoundary, /club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'staff\.permissions_manage'\)/);
});

test("Staff UI exposes package state, individual overrides, and separate Coach state", () => {
  assert.match(staffPage, /Coach\/PT: \{coachEligible \? coachEnabled \? "Enabled" : "Disabled"/);
  assert.match(staffPage, /Enable Coach access/);
  assert.match(staffPage, /Disable Coach access/);
  assert.match(staffEditor, /Individual permissions/);
  assert.match(staffEditor, /checked=\{effective\.includes\(capability\)\}/);
  assert.match(staffEditor, /management only/);
});

test("audit attribution is always derived from the authenticated user", () => {
  assert.match(migration, /actor_user_id,actor_role/);
  assert.match(migration, /values\(p_organisation_id,auth\.uid\(\),actor_role/);
  assert.match(migration, /select p_organisation_id,auth\.uid\(\),m\.role,'staff\./);
  assert.doesNotMatch(migration, /p_actor_user_id/);
});

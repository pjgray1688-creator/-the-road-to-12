import assert from "node:assert/strict";
import test from "node:test";
import { hasClubCapability, resolveClubCapabilities } from "@/lib/club-capabilities";

test("capabilities combine role presets with explicit deny precedence", () => {
  assert.equal(hasClubCapability("gym_staff", "payments.take"), true);
  assert.equal(hasClubCapability("gym_staff", "refunds.issue"), false);
  assert.equal(hasClubCapability("gym_staff", "refunds.issue", [{ capability: "refunds.issue", decision: "allow" }]), true);
  assert.equal(hasClubCapability("gym_staff", "payments.take", [{ capability: "payments.take", decision: "deny" }]), false);
  assert.equal(resolveClubCapabilities("owner").includes("staff.permissions_manage"), true);
  assert.equal(hasClubCapability("owner", "staff.permissions_manage", [{ capability: "staff.permissions_manage", decision: "deny" }]), true);
  assert.equal(hasClubCapability("gym_staff", "staff.permissions_manage", [{ capability: "staff.permissions_manage", decision: "allow" }]), false);
  assert.equal(hasClubCapability("gym_admin", "future.capability" as never, [{ capability: "future.capability", decision: "allow" }]), false);
});

test("capability migration has a closed vocabulary and matching explicit presets", () => {
  const source = require("node:fs").readFileSync("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql", "utf8");
  for (const capability of ["members.view", "members.create", "members.link_account", "memberships.assign", "memberships.end_immediately", "payments.take", "payments.record_cash", "refunds.issue", "refunds.approve", "cash.reconcile", "inventory.adjust", "staff.permissions_manage", "induction.manage_policy", "classes.manage", "services.manage"]) {
    assert.match(source, new RegExp(capability.replace(".", "\\.")));
  }
  assert.doesNotMatch(source, /capability\s+not\s+like/);
  assert.doesNotMatch(source, /capability\s*!=/);
  assert.match(source, /Unknown capability/);
  assert.match(source, /role in \('gym_staff','gym_admin','owner'\)/);
});

test("capability lookup and audit boundaries derive identity server-side", () => {
  const source = require("node:fs").readFileSync("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql", "utf8");
  assert.match(source, /p_user_id is distinct from auth\.uid\(\)/);
  assert.match(source, /actor_user_id,actor_role/);
  assert.match(source, /p_location_id is not null and not exists/);
  assert.match(source, /'actor_user_id' - 'organisation_id' - 'actor_role'/);
  assert.match(source, /'staff\.permission_changed'/);
  assert.match(source, /revoke all on table public\.club_staff_permission_overrides from public, anon, authenticated/);
  assert.match(source, /revoke all on table public\.club_audit_events from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.club_capability_allowed/);
  assert.match(source, /grant execute on function public\.club_save_staff_permission/);
  assert.match(source, /grant execute on function public\.club_append_audit_event/);
});

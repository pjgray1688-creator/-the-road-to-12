import assert from "node:assert/strict";
import test from "node:test";
import { hasClubCapability, resolveClubCapabilities } from "@/lib/club-capabilities";

test("capabilities combine role presets with explicit deny precedence", () => {
  assert.equal(hasClubCapability("gym_staff", "payments.take"), true);
  assert.equal(hasClubCapability("gym_staff", "refunds.issue"), false);
  assert.equal(hasClubCapability("gym_staff", "refunds.issue", [{ capability: "refunds.issue", decision: "allow" }]), true);
  assert.equal(hasClubCapability("gym_staff", "payments.take", [{ capability: "payments.take", decision: "deny" }]), false);
  assert.equal(resolveClubCapabilities("owner").includes("staff.permissions_manage"), true);
});

test("capability migration protects actor identity and organisation scope", () => {
  const source = require("node:fs").readFileSync("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql", "utf8");
  assert.match(source, /auth\.uid\(\)/);
  assert.match(source, /organisation_id/);
  assert.match(source, /revoke all on function/);
});

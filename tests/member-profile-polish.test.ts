import assert from "node:assert/strict";
import test from "node:test";
import { splitMemberProfileMemberships } from "../lib/member-profile-view";

test("profile keeps only active and paused memberships in the current section", () => {
  const memberships = [
    { id: "lifetime", product_name: "Golden Ticket", status: "active", starts_at: "2026-09-04" },
    { id: "imported-duplicate", product_name: "Golden Ticket", status: "cancelled", starts_at: "2026-09-02" },
    { id: "paused", product_name: "Monthly", status: "paused", starts_at: "2026-08-01" },
    { id: "old", status: "expired", starts_at: "2024-01-01" },
  ];

  const result = splitMemberProfileMemberships(memberships);
  assert.deepEqual(result.current.map(item => item.id), ["lifetime", "paused"]);
  assert.deepEqual(result.past.map(item => item.id), ["imported-duplicate", "old"]);
});

test("profile handles a missing membership collection without inventing a membership", () => {
  assert.deepEqual(splitMemberProfileMemberships(undefined), { current: [], past: [] });
  assert.deepEqual(splitMemberProfileMemberships([]), { current: [], past: [] });
});

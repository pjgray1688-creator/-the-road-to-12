import assert from "node:assert/strict";
import test from "node:test";
import { toClubNavContexts, type ClubOrganisationContext } from "../lib/club-server-context";

test("Club overview projects repository contexts before passing them to client navigation", () => {
  const repository = {} as ClubOrganisationContext["repository"];
  const context = { repository, organisation: { id: "org", name: "Gym", slug: "gym", active: true }, members: [], member: { id: "m", organisationId: "org", userId: "u", role: "owner" as const, active: true }, role: "owner" as const };
  const nav = toClubNavContexts([context]);
  assert.deepEqual(nav, [{ organisation: context.organisation, role: "owner" }]);
  assert.equal("repository" in nav[0]!, false);
});

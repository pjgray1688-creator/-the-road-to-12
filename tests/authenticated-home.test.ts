import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authHomeStateForUser } from "../lib/auth-home-state";

test("a restored authenticated session leaves the root splash and mounts HomeShell", () => {
  assert.equal(authHomeStateForUser("reviewer-user"), "signed_in");
  assert.equal(authHomeStateForUser(null), "signed_out");

  const source = readFileSync("components/authenticated-home.tsx", "utf8");
  assert.match(source, /setState\(authHomeStateForUser\(id\)\)/);
  assert.match(source, /if \(state === "signed_in" && userId\) return <HomeShell/);
  assert.doesNotMatch(source, /setState\(id \? "loading" : "signed_out"\)/);
  assert.doesNotMatch(source, /userId \? <HomeShell[\s\S]*auth-splash/);
});

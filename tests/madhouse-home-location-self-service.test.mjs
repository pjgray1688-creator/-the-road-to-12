import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/deployment/applied/2026-11-11-madhouse-home-location-self-service.sql", "utf8");
const action = readFileSync("app/member-hub/profile/actions.ts", "utf8");

test("applied home-gym SQL source is isolated from unfinished public joining RPCs", () => {
  assert.match(sql, /club_set_my_home_location_self\(p_organisation_id uuid,p_location_id uuid\)/);
  assert.match(sql, /slug is distinct from 'madhouse-gym'/);
  assert.match(sql, /club_members where organisation_id=p_organisation_id and user_id=auth\.uid\(\) and active/);
  assert.match(sql, /v_location_name not like '%rotherham%' and v_location_name not like '%carlton%'/);
  assert.match(sql, /revoke all on function public\.club_set_my_home_location_self\(uuid,uuid\) from public,anon/);
  assert.doesNotMatch(sql, /club_start_membership_joining_optional_home_location/);
  assert.match(sql, /do not execute or add this file to a migration runner/i);
});

test("member profile calls the self-scoped home-gym RPC", () => {
  assert.match(action, /club_set_my_home_location_self/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLOW_SESSION_MINUTES, glowBedLabel, isGlowBedType, isGlowSessionDuration } from "../lib/glow-zone";

const migration=readFileSync(new URL("../supabase/migrations/2026-10-25-glow-zone-session-requests.sql",import.meta.url),"utf8");
const actions=readFileSync(new URL("../app/club/sunbeds/actions.ts",import.meta.url),"utf8");
const reception=readFileSync(new URL("../components/glow-zone-reception-scanner.tsx",import.meta.url),"utf8");
const manual=readFileSync(new URL("../components/club-sunbed-operations.tsx",import.meta.url),"utf8");
const transactional=readFileSync(new URL("../supabase/migrations/2026-10-13-glow-zone-transactional.sql",import.meta.url),"utf8");
const operations=readFileSync(new URL("../supabase/migrations/2026-10-14-glow-zone-operations.sql",import.meta.url),"utf8");

test("Glow Zone session duration is restricted to every integer from 1 to 15",()=>{
 assert.deepEqual(GLOW_SESSION_MINUTES,{min:1,max:15});
 for(let value=1;value<=15;value++)assert.equal(isGlowSessionDuration(value),true);
 for(const value of [0,16,1.5,"5",null,undefined])assert.equal(isGlowSessionDuration(value),false);
 assert.match(migration,/duration_minutes integer not null check \(duration_minutes between 1 and 15\)/);
});

test("only the two explicit bed selections are accepted",()=>{
 assert.equal(isGlowBedType("stand_up"),true);assert.equal(isGlowBedType("lying_down"),true);
 assert.equal(isGlowBedType("standup"),false);assert.equal(isGlowBedType("other"),false);
 assert.equal(glowBedLabel("stand_up"),"Stand-up");assert.equal(glowBedLabel("lying_down"),"Lying-down");
 assert.match(migration,/bed_type in \('stand_up','lying_down'\)/);
});

test("member requests are account-owned, server-tokened, short-lived and do not spend",()=>{
 assert.match(migration,/v_user uuid := auth\.uid\(\)/);
 assert.match(migration,/club_customers c where c\.organisation_id=p_organisation_id and c\.user_id=v_user/);
 assert.match(migration,/o\.slug='madhouse-gym'[\s\S]*lower\(l\.name\) like '%carlton%'/);
 assert.match(migration,/extensions\.gen_random_bytes\(16\)/);
 assert.match(migration,/now\(\)\+interval '5 minutes'/);
 const createBody=migration.slice(migration.indexOf("club_glow_create_session_request"),migration.indexOf("club_glow_get_session_request"));
 assert.doesNotMatch(createBody,/club_glow_spend/);
 assert.match(actions,/resolveGlowZoneCustomerContext/);
});

test("request creation checks current unexpired balance and cancellation preserves it",()=>{
 assert.match(migration,/remaining_quantity[\s\S]*expires_at is null or l\.expires_at > now\(\)/);
 assert.match(migration,/if v_balance < p_duration_minutes then raise exception 'Insufficient Glow Zone minutes'/);
 const cancelBody=migration.slice(migration.indexOf("club_glow_cancel_session_request"),migration.indexOf("club_glow_scan_session_request"));
 assert.doesNotMatch(cancelBody,/club_glow_spend/);
 assert.match(cancelBody,/status='cancelled'/);
});

test("expired, cancelled and already-used requests are handled explicitly",()=>{
 assert.match(migration,/status text not null default 'pending' check \(status in \('pending','cancelled','redeemed','expired'\)\)/);
 assert.match(migration,/if r\.status='redeemed' then return[\s\S]*'already_used',true/);
 assert.match(migration,/if r\.status='cancelled' then raise exception 'This session request was cancelled'/);
 assert.match(migration,/raise exception 'This session request has expired'/);
});

test("approval is capability, location and adult-verification gated",()=>{
 assert.match(migration,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'services\.manage'\)/);
 assert.match(migration,/club_location_authorized\(p_organisation_id,p_location_id\)/);
 assert.match(migration,/lower\(name\) like '%carlton%'/);
 assert.match(migration,/club_glow_spend\(p_organisation_id,r\.user_id,p_location_id,r\.duration_minutes/);
 assert.match(transactional,/status='verified' and date_of_birth <= \(current_date - interval '18 years'\)::date/);
 assert.match(transactional,/if not coalesce\(adult,false\) then raise exception 'Glow Zone age verification required'/);
 assert.match(migration,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'induction\.perform'\)/);
 assert.match(reception,/request\.age_status==="verified"/);
});

test("concurrent or duplicate approval can produce only one deduction",()=>{
 assert.match(migration,/for update;/);
 assert.match(migration,/'glow-session:'\|\|r\.id::text/);
 assert.match(migration,/usage_id uuid references public\.club_service_credit_usage\(id\) on delete restrict/);
 assert.match(migration,/update public\.club_glow_session_requests set status='redeemed'/);
 assert.match(migration,/unique \(organisation_id, token_hash\)/);
 assert.match(transactional,/unique \(organisation_id,idempotency_key\)/);
 assert.match(operations,/club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id/);
});

test("reception requires explicit bed and duration confirmation and remains truthful",()=>{
 assert.match(reception,/bedConfirmed&&durationConfirmed/);
 assert.match(reception,/I confirm the member selected/);
 assert.match(reception,/I confirm the requested duration/);
 assert.match(reception,/does not claim to activate the physical bed/);
 assert.match(reception,/BarcodeDetector/);
 assert.match(reception,/reception scanner or enter the code/);
});

test("existing manual customer lookup, usage, top-up and adjustment operations remain",()=>{
 for(const contract of ["searchGlowCustomersAction","recordSunbedUseAction","completeGlowSaleAction","adjustGlowMinutesAction","removeGlowMinutesAction"])assert.match(manual,new RegExp(contract));
 assert.match(manual,/Manual reception operations remain available/);
});

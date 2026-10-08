import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localDateTimeToIso, londonDateTime, scheduleConflict, type ScheduleEvent } from "../lib/club-scheduling";

const event=(id:string,staffUserId:string,startsAt:string,endsAt:string,locationId:string):ScheduleEvent=>({id,eventType:"pt_session",staffUserId,startsAt,endsAt,locationId,title:id,status:"scheduled"});

test("PT/class and unavailable overlaps are blocked across location boundaries",()=>{
 const existing=[event("pt","trainer-a","2026-10-08T17:00:00Z","2026-10-08T18:00:00Z","rotherham"),{...event("leave","trainer-a","2026-10-10T08:00:00Z","2026-10-10T18:00:00Z","carlton"),eventType:"leave" as const}];
 assert.equal(scheduleConflict(existing,"trainer-a","2026-10-08T17:30:00Z","2026-10-08T18:30:00Z")?.id,"pt");
 assert.equal(scheduleConflict(existing,"trainer-a","2026-10-10T09:00:00Z","2026-10-10T10:00:00Z")?.id,"leave");
 assert.equal(scheduleConflict(existing,"trainer-b","2026-10-08T17:30:00Z","2026-10-08T18:30:00Z"),undefined);
});

test("UK local date/time resolves winter and summer offsets and rejects the spring DST gap",()=>{
 assert.equal(localDateTimeToIso("2026-01-15T18:00"),"2026-01-15T18:00:00.000Z");
 assert.equal(localDateTimeToIso("2026-07-15T18:00"),"2026-07-15T17:00:00.000Z");
 assert.throws(()=>localDateTimeToIso("2026-03-29T01:30"),/invalid_local_time/);
 assert.equal(londonDateTime("2026-07-15T17:00:00.000Z",{hour:"2-digit",minute:"2-digit"}),"18:00");
});

test("database boundary combines classes and PT events, scopes member results, and protects private notes",()=>{
 const sql=readFileSync("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql","utf8");
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/club_class_sessions c where c\.organisation_id=p_organisation_id/);
 assert.match(sql,/club_schedule_events e where e\.organisation_id=p_organisation_id/);
 assert.match(sql,/c\.user_id=auth\.uid\(\)/);
 assert.match(sql,/e\.event_type='pt_session' and e\.status='scheduled'/);
 assert.match(sql,/case when can_notes or e\.staff_user_id=auth\.uid\(\) then e\.internal_notes end/);
 assert.match(sql,/existing\.title is distinct from result\.title/);
 assert.match(sql,/club_member_notification_intents/);
 assert.match(sql,/in_app_visible boolean not null default false/);
 assert.match(sql,/club_list_my_schedule_notifications/);
 assert.match(sql,/club_mark_my_schedule_notification_seen/);
 assert.match(sql,/n\.user_id=auth\.uid\(\) and n\.in_app_visible/);
 assert.match(sql,/p_to-p_from>interval '62 days'/);
});

test("schedule writes are capability checked and trainers are restricted to their own items",()=>{
 const sql=readFileSync("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql","utf8");
 assert.match(sql,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'classes\.manage'\)/);
 assert.match(sql,/self_trainer:=public\.club_has_active_role\(p_organisation_id,array\['trainer'\]\) and p_staff_user_id=auth\.uid\(\)/);
 assert.match(sql,/existing\.staff_user_id<>auth\.uid\(\)/);
 assert.match(sql,/club_locations where id=p_location_id and organisation_id=p_organisation_id/);
});

test("weekly hours are recurring London wall time, editable by self, and gate PT booking with an audited manager override",()=>{
 const sql=readFileSync("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql","utf8");
 assert.match(sql,/club_staff_weekly_working_hours[\s\S]+weekday between 1 and 7[\s\S]+starts_at time[\s\S]+ends_at time/);
 assert.match(sql,/club_save_staff_weekly_working_hours[\s\S]+own_trainer:=public\.club_has_active_role\(p_organisation_id,array\['trainer'\]\) and p_staff_user_id=auth\.uid\(\)/);
 assert.match(sql,/p_starts_at at time zone 'Europe\/London'/);
 assert.match(sql,/perform pg_advisory_xact_lock\(hashtextextended\(p_organisation_id::text\|\|':'\|\|p_staff_user_id::text,0\)\);[\s\S]+select not exists\(select 1 from public\.club_staff_weekly_working_hours/);
 assert.match(sql,/falls outside the coach’s normal working hours/);
 assert.match(sql,/schedule\.working_hours_override/);
});

test("private PT clients stay separate from member identity, are organisation-scoped, and never enter member schedule results",()=>{
 const sql=readFileSync("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql","utf8");
 assert.match(sql,/club_schedule_private_clients[\s\S]+organisation_id uuid not null[\s\S]+display_name text not null[\s\S]+linked_customer_id uuid/);
 assert.match(sql,/foreign key \(linked_customer_id,organisation_id\) references public\.club_customers/);
 assert.match(sql,/club_create_schedule_private_client/);
 assert.match(sql,/club_search_schedule_private_clients/);
 assert.match(sql,/private_client_id is not null and not \(can_notes or e\.staff_user_id=auth\.uid\(\)\) then 'PT session'/);
 const memberFunction=sql.slice(sql.indexOf("create or replace function public.club_list_my_schedule"),sql.indexOf("create or replace function public.club_list_schedule_staff"));
 assert.doesNotMatch(memberFunction,/private_client/);
 const ui=readFileSync("components/club-schedule-calendar.tsx","utf8");
 assert.match(ui,/Private client/);
 assert.match(ui,/createSchedulePrivateClientAction/);
});

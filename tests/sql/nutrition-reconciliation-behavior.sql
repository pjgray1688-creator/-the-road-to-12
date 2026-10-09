\set ON_ERROR_STOP on

-- Fixed, isolated fixture identities. The only authenticated-context mechanism
-- used is the same request.jwt.claim.sub setting read by the CI auth.uid stub.
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000101','nutrition-member@example.test',now()),
 ('00000000-0000-0000-0000-000000000102','nutrition-assigned@example.test',now()),
 ('00000000-0000-0000-0000-000000000103','nutrition-other-org-member@example.test',now()),
 ('00000000-0000-0000-0000-000000000201','nutrition-primary@example.test',now()),
 ('00000000-0000-0000-0000-000000000202','nutrition-cover@example.test',now()),
 ('00000000-0000-0000-0000-000000000203','nutrition-unrelated@example.test',now()),
 ('00000000-0000-0000-0000-000000000204','nutrition-other-org-coach@example.test',now());

insert into public.profiles(id,first_name,last_name,display_name,timezone) values
 ('00000000-0000-0000-0000-000000000101','Member','One','Member One','Europe/London'),
 ('00000000-0000-0000-0000-000000000102','Member','Assigned','Member Assigned','Europe/London'),
 ('00000000-0000-0000-0000-000000000103','Member','Other','Member Other','Europe/London'),
 ('00000000-0000-0000-0000-000000000201','Primary','Coach','Primary Coach','Europe/London'),
 ('00000000-0000-0000-0000-000000000202','Cover','Coach','Cover Coach','Europe/London'),
 ('00000000-0000-0000-0000-000000000203','Unrelated','Coach','Unrelated Coach','Europe/London'),
 ('00000000-0000-0000-0000-000000000204','Other','Coach','Other Organisation Coach','Europe/London');

insert into public.club_organisations(id,name,slug,active) values
 ('00000000-0000-0000-0000-000000000301','Nutrition CI One','nutrition-ci-one',true),
 ('00000000-0000-0000-0000-000000000302','Nutrition CI Two','nutrition-ci-two',true);
insert into public.club_members(organisation_id,user_id,role,active) values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000101','member',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000102','member',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','trainer',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000202','trainer',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000203','trainer',true),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000103','member',true),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000204','trainer',true);
insert into public.coach_permissions(organisation_id,user_id,granted_by,active) values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201',true),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000201',true),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000204',true);

insert into public.coach_relationships(id,organisation_id,coach_user_id,client_user_id,client_email,relationship_type,programme_owner_user_id,status,requested_by,accepted_by,accepted_at) values
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','nutrition-member@example.test','primary','00000000-0000-0000-0000-000000000201','active','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101',now()),
 ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000101','nutrition-member@example.test','cover','00000000-0000-0000-0000-000000000201','active','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000101',now()),
 ('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000101','nutrition-member@example.test','cover','00000000-0000-0000-0000-000000000201','active','00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000101',now());
insert into public.coach_client_assignments(id,organisation_id,coach_user_id,client_user_id,relationship_type,programme_owner_user_id,active,created_by) values
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','primary','00000000-0000-0000-0000-000000000201',true,'00000000-0000-0000-0000-000000000201'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000102','primary','00000000-0000-0000-0000-000000000201',true,'00000000-0000-0000-0000-000000000201');

-- This unrelated check-in is a negative feedback-ownership fixture.
insert into public.nutrition_daily_checkins(id,client_user_id,plan_id,checkin_date,adherence,client_note)
values ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000103',null,(now() at time zone 'Europe/London')::date-1,'mostly','other member fixture');

do $$
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
  if not public.nutrition_can_read_client('00000000-0000-0000-0000-000000000101') then raise exception 'Primary Coach could not read assigned client'; end if;
  if not public.nutrition_can_read_client('00000000-0000-0000-0000-000000000102') then raise exception 'Primary Coach could not read Club-assigned client'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000203',false);
  if public.nutrition_can_read_client('00000000-0000-0000-0000-000000000101') then raise exception 'Unrelated Coach read was not denied'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000204',false);
  if public.nutrition_can_read_client('00000000-0000-0000-0000-000000000101') then raise exception 'Cross-organisation Coach read was not denied'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',false);
  if not public.nutrition_can_read_client('00000000-0000-0000-0000-000000000101') then raise exception 'Cover Coach read access was not retained'; end if;
  if public.nutrition_can_manage_plan('00000000-0000-0000-0000-000000000101') then raise exception 'Cover Coach received plan management'; end if;
end $$;

set role authenticated;
do $$
declare
  v_plan jsonb;
  v_plan_id uuid;
  v_assignment_plan jsonb;
  v_checkin jsonb;
  v_checkin_id uuid;
  v_repeat jsonb;
  v_member jsonb;
  v_foreign_checkin uuid;
  v_denied boolean;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
  v_plan:=public.nutrition_save_draft(
    '00000000-0000-0000-0000-000000000101',
    '{"title":"CI Primary plan","clientNotes":"member-safe note","coachPrivateNotes":"CI_PRIVATE_SECRET","targets":{"calories":2100,"protein":150},"meals":[{"title":"Breakfast","items":[{"description":"Oats"}],"alternatives":[{"description":"Eggs"}]}],"supplements":[{"name":"Creatine"}]}'::jsonb
  );
  v_plan_id:=(v_plan->>'id')::uuid;
  if v_plan->>'organisationId' is distinct from '00000000-0000-0000-0000-000000000301'
     or v_plan->>'relationshipId' is distinct from '00000000-0000-0000-0000-000000000401' then
    raise exception 'Direct Coach relationship context was not preserved on plan creation';
  end if;
  v_plan:=public.nutrition_save_draft(
    '00000000-0000-0000-0000-000000000101',
    '{"title":"CI Primary plan","clientNotes":"updated safely","coachPrivateNotes":"CI_PRIVATE_SECRET"}'::jsonb,
    v_plan_id
  );
  perform public.nutrition_activate_plan(v_plan_id);

  -- A Club assignment has no coach_relationships row; retain its real org and
  -- leave relationship_id null rather than inventing a cross-domain FK.
  v_assignment_plan:=public.nutrition_save_draft(
    '00000000-0000-0000-0000-000000000102',
    '{"title":"CI Club assignment plan","coachPrivateNotes":"assignment private"}'::jsonb
  );
  if v_assignment_plan->>'organisationId' is distinct from '00000000-0000-0000-0000-000000000301'
     or v_assignment_plan->>'relationshipId' is not null then
    raise exception 'Club assignment plan context is not correctly organisation-scoped';
  end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
  v_member:=public.nutrition_get_member_view('Europe/London');
  if v_member#>>'{plan,title}' is distinct from 'CI Primary plan' then raise exception 'Member did not receive their own active plan'; end if;
  if v_member#>>'{plan,coachPrivateNotes}' is not null
     or v_member::text like '%CI_PRIVATE_SECRET%' then raise exception 'Coach-private notes leaked to Member projection'; end if;
  v_checkin:=public.nutrition_save_daily_checkin('followed','first submission','Europe/London');
  v_checkin_id:=(v_checkin->>'id')::uuid;
  v_repeat:=public.nutrition_save_daily_checkin('mostly','same-day update','Europe/London');
  if (v_repeat->>'id')::uuid is distinct from v_checkin_id or v_repeat->>'adherence' is distinct from 'mostly' then
    raise exception 'Same-day check-in did not update the original row';
  end if;
  v_foreign_checkin:='00000000-0000-0000-0000-000000000000';
  v_foreign_checkin:='00000000-0000-0000-0000-000000000601';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',false);
  v_member:=public.nutrition_get_member_view('Europe/London');
  if v_member->'plan' is not null and v_member->'plan'<>'null'::jsonb then raise exception 'Member received another client’s plan'; end if;
  v_denied:=false;
  begin
    perform public.nutrition_save_daily_checkin('followed','attempt against another member','Europe/London');
  exception when sqlstate '22023' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Member without their own active plan submitted accountability'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',false);
  v_denied:=false;
  begin
    perform public.nutrition_save_draft('00000000-0000-0000-0000-000000000101','{"title":"Cover must not edit"}'::jsonb);
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Cover Coach edited a Primary-owned nutrition plan'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000203',false);
  v_denied:=false;
  begin
    perform public.nutrition_get_coach_view('00000000-0000-0000-0000-000000000101','Europe/London');
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Unrelated Coach received a client Nutrition projection'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000204',false);
  v_denied:=false;
  begin
    perform public.nutrition_get_coach_view('00000000-0000-0000-0000-000000000101','Europe/London');
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Cross-organisation Coach received a client Nutrition projection'; end if;
  v_denied:=false;
  begin
    perform public.nutrition_save_draft('00000000-0000-0000-0000-000000000101','{"title":"Cross-org write must fail"}'::jsonb);
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Cross-organisation Coach wrote another organisation client plan'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
  v_denied:=false;
  begin
    perform public.nutrition_leave_feedback(
      '00000000-0000-0000-0000-000000000101',v_foreign_checkin,'wrong client check-in',true,false
    );
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Coach feedback was attached to another client check-in'; end if;
  perform public.nutrition_leave_feedback(
    '00000000-0000-0000-0000-000000000101',v_checkin_id,'Private Coach feedback',true,true
  );

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
  v_member:=public.nutrition_get_member_view('Europe/London');
  if v_member::text like '%Private Coach feedback%' then raise exception 'Private Coach feedback leaked to Member projection'; end if;

  -- Activating the later plan must not change the plan id on the existing
  -- same-day accountability record.
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
  v_plan:=public.nutrition_save_draft(
    '00000000-0000-0000-0000-000000000101',
    '{"title":"CI Revised plan","coachPrivateNotes":"second private"}'::jsonb
  );
  perform public.nutrition_activate_plan((v_plan->>'id')::uuid);
end $$;
reset role;

do $$
declare v_original_plan uuid; v_current_plan uuid;
begin
  select id into v_original_plan from public.nutrition_plans
  where client_user_id='00000000-0000-0000-0000-000000000101' and title='CI Primary plan' and status='superseded';
  select id into v_current_plan from public.nutrition_plans
  where client_user_id='00000000-0000-0000-0000-000000000101' and title='CI Revised plan' and status='active';
  if v_original_plan is null or v_current_plan is null then raise exception 'Plan activation history is incomplete'; end if;
  if exists(select 1 from public.nutrition_daily_checkins where client_user_id='00000000-0000-0000-0000-000000000102') then
    raise exception 'Failed check-in attempt wrote a row';
  end if;
  if (select count(*) from public.nutrition_daily_checkins
      where client_user_id='00000000-0000-0000-0000-000000000101'
        and plan_id=v_original_plan and adherence='mostly' and client_note='same-day update')<>1 then
    raise exception 'Same-day check-in attribution changed after activating a later plan';
  end if;
  raise notice 'Nutrition RPC behavior verified: scope, Primary/Cover, member privacy, assignment context, check-in idempotency/history, and feedback ownership';
end $$;

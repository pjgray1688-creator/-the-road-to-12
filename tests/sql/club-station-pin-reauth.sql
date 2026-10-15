-- Disposable database regression for server-verified Club PIN management.
-- Password verification itself is performed by the application route against
-- Supabase Auth; no password or production identity is used by this fixture.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('40000000-0000-4000-8000-000000000001','station-pin-owner@example.test',now());
insert into public.club_organisations(id,name,slug) values
 ('40000000-0000-4000-8000-000000000002','Station PIN test','station-pin-test');
insert into public.club_locations(id,organisation_id,name) values
 ('40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000002','Station PIN venue');
insert into public.club_members(organisation_id,user_id,role,active) values
 ('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','owner',true);
insert into public.club_shared_stations(id,organisation_id,location_id,station_name,token_hash,created_by) values
 ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','CI Station',extensions.digest(convert_to('ci-station-token','UTF8'),'sha256'),'40000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.club_station_set_pin_after_password(
 '40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','2468'
);
reset role;

-- These are test-only inspections of protected state and pgcrypto output.
-- Run them as the disposable database owner, not as the simulated worker role.
do $$
begin
 if not exists(select 1 from public.club_station_staff_pins
   where organisation_id='40000000-0000-4000-8000-000000000002'
     and user_id='40000000-0000-4000-8000-000000000001'
     and enabled and failed_attempts=0 and pin_hash<> '2468'
     and extensions.crypt('2468',pin_hash)=pin_hash) then
   raise exception 'Server-authorised PIN was not securely hashed and enabled';
 end if;
 if not exists(select 1 from public.club_audit_events where organisation_id='40000000-0000-4000-8000-000000000002' and actor_user_id='40000000-0000-4000-8000-000000000001' and action='staff.station_pin_set') then
   raise exception 'PIN setup was not attributed to the staff member';
 end if;
end $$;

-- Five incorrect PINs lock this person; the correct PIN is rejected until the
-- lock window has elapsed, then succeeds for that exact station and identity.
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$
declare i integer; result jsonb;
begin
 for i in 1..5 loop
   result:=public.club_station_verify_pin('40000000-0000-4000-8000-000000000004','ci-station-token','40000000-0000-4000-8000-000000000001','1111');
   if result is not null then raise exception 'Wrong PIN was accepted'; end if;
 end loop;
 result:=public.club_station_verify_pin('40000000-0000-4000-8000-000000000004','ci-station-token','40000000-0000-4000-8000-000000000001','2468');
 if result is not null then raise exception 'Correct PIN bypassed the five-attempt lockout'; end if;
end $$;
reset role;
do $$
begin
 if (select failed_attempts from public.club_station_staff_pins where organisation_id='40000000-0000-4000-8000-000000000002' and user_id='40000000-0000-4000-8000-000000000001')<>5 then
   raise exception 'Five incorrect PINs did not reach the lockout threshold';
 end if;
end $$;

update public.club_station_staff_pins set locked_until=now()-interval '1 second'
where organisation_id='40000000-0000-4000-8000-000000000002' and user_id='40000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$
declare result jsonb;
begin
 result:=public.club_station_verify_pin('40000000-0000-4000-8000-000000000004','ci-station-token','40000000-0000-4000-8000-000000000001','2468');
 if result->>'userId' is distinct from '40000000-0000-4000-8000-000000000001' or result->>'email' is distinct from 'station-pin-owner@example.test' then
   raise exception 'Correct PIN did not unlock the matching verified staff identity';
 end if;
end $$;
select public.club_station_disable_pin_after_password('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001');
reset role;

-- Inspect final protected state and grants as the disposable database owner.
do $$
begin
 if (select enabled from public.club_station_staff_pins where organisation_id='40000000-0000-4000-8000-000000000002' and user_id='40000000-0000-4000-8000-000000000001') is distinct from false then
   raise exception 'Disable PIN did not disable this staff member’s PIN';
 end if;
 if has_function_privilege('authenticated','public.club_station_set_pin_after_password(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.club_station_set_pin_after_password(uuid,uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.club_station_set_pin_after_password(uuid,uuid,text)','EXECUTE') then
   raise exception 'Server-only PIN function grants are not narrow';
 end if;
end $$;

select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","auth_time":1}',true);
set local role authenticated;
do $$
begin
 begin
   perform public.club_station_set_my_pin('40000000-0000-4000-8000-000000000002','8642');
   raise exception 'Expired reauthentication claim was accepted';
 exception when sqlstate '42501' then null; end;
 begin
   perform public.club_station_set_pin_after_password('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','8642');
   raise exception 'Authenticated browser role invoked the server-only PIN function';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

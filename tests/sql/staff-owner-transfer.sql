-- Disposable PostgreSQL integration exercise for 12-24 only. Never run on shared/prod DBs.
begin;
insert into auth.users(id,email) values
 ('20000000-0000-4000-8000-000000000001','owner-transfer-current@example.test'),
 ('20000000-0000-4000-8000-000000000002','owner-transfer-target@example.test'),
 ('20000000-0000-4000-8000-000000000003','owner-transfer-foreign@example.test');
insert into public.club_organisations(id,name,slug) values
 ('20000000-0000-4000-8000-000000000011','Owner transfer test','owner-transfer-test'),
 ('20000000-0000-4000-8000-000000000012','Foreign organisation test','owner-transfer-foreign');
insert into public.club_members(organisation_id,user_id,role,active) values
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','owner',true),
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002','gym_admin',true),
 ('20000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000003','gym_admin',true);
insert into public.club_locations(id,organisation_id,name) values
 ('20000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000011','Owner test venue');
insert into public.club_staff_location_access(organisation_id,user_id,location_id) values
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000021');
insert into public.coach_permissions(organisation_id,user_id,granted_by,active) values
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',true);

select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.club_transfer_organisation_owner('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002');
reset role;

do $$
begin
  if (select role from public.club_members where organisation_id='20000000-0000-4000-8000-000000000011' and user_id='20000000-0000-4000-8000-000000000002') <> 'owner'
     or (select role from public.club_members where organisation_id='20000000-0000-4000-8000-000000000011' and user_id='20000000-0000-4000-8000-000000000001') <> 'gym_admin' then
    raise exception 'Owner transfer did not promote/demote the expected active members';
  end if;
  if not exists(select 1 from public.coach_permissions where organisation_id='20000000-0000-4000-8000-000000000011' and user_id='20000000-0000-4000-8000-000000000002' and active)
     or not exists(select 1 from public.club_staff_location_access where organisation_id='20000000-0000-4000-8000-000000000011' and user_id='20000000-0000-4000-8000-000000000002' and location_id='20000000-0000-4000-8000-000000000021') then
    raise exception 'Owner transfer changed Coach permission or venue access';
  end if;
  if not exists(select 1 from public.club_audit_events where organisation_id='20000000-0000-4000-8000-000000000011' and action='organisation.owner_transferred') then
    raise exception 'Owner transfer did not record its audit event';
  end if;
end $$;

-- Validation errors are tested as the NEW active Owner. The RPC checks
-- caller ownership before validating a non-self target, so this role is
-- necessary to reach cross-organisation target validation.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
begin
  begin
    perform public.club_transfer_organisation_owner('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002');
    raise exception 'Self-transfer should have been rejected';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.club_transfer_organisation_owner('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000003');
    raise exception 'Cross-organisation target should have been rejected';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{}',true);

-- The demoted user is still authenticated and active, but no longer Owner.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
begin
  begin
    perform public.club_transfer_organisation_owner('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002');
    raise exception 'Demoted former owner should not retain transfer authority';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{}',true);
rollback;

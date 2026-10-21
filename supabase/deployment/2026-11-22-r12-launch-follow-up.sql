-- R12 launch follow-up SQL release: outstanding migrations only.
-- Production has reported 2027-01-04 through 2027-01-09 as applied; this file
-- verifies those checksums and does not include/replay those migrations.
-- Apply once to the reviewed production Supabase project, using the SQL editor
-- or psql with stop-on-error. The complete release is one PostgreSQL transaction.
-- Take/verify a restorable backup first. No operational/member/payment rows are seeded.
--
-- Required order: 2027-01-10 -> 2027-01-11 -> 2027-01-12 -> 2027-01-13.
-- 2027-01-13 depends on the PayPal foundation from 2027-01-03. The preflight
-- requires its exact ledger checksum and core tables; if absent, this file aborts
-- before making changes. Do not apply 2027-01-03 blindly as part of this release.

begin;
set local lock_timeout = '10s';

-- Read-only preflight: schema ledger, already-applied Madhouse chain,
-- PayPal foundation dependency, and checksums for this outstanding bundle.
do $preflight$
declare v_name text; v_expected text; v_actual text;
begin
  if to_regclass('public.r12_schema_migrations') is null then raise exception 'R12 migration ledger is missing'; end if;
  for v_name, v_expected in select * from (values
    ('supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql','efa7d602235d74fedeeefd2ce26ca3ab5bf6ba000c28b2a2def12c79c4b229ef'),
    ('supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql','3ecd2a330e4ccdb3a3db16e3f68fa4869dd95de16b7ecdba8cc7c73271df09a7'),
    ('supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql','d2b7323eb157bae8906a39b9dc26c3ff41ad3dad6e129d38c65be5056b49ab6c'),
    ('supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql','611d789195b14188097d516590b0428a37cafacb26cbcc281ecc2b12e40bcf0d'),
    ('supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql','89c407d836cc9605297c4e27573ad381e83020ab700967242ab3e1044733cdaa'),
    ('supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql','d590f5d58c23da0e0b3e704d925b669e520608b4d967b1d176333dd2872db037'),
    ('supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql','55e2fb75ebb130a6da06ba04c9eb07b235dadc114b42fb36627f75750e5a5fba'),
    ('supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql','088c5a60315a09efcc4e64584501b8b5f59f753d00c447fa92030ff16d6a67fd'),
    ('supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql','ae6bcb7e1ac713ed329f9be2809949753b67310dc6c2ce3b00557afe602c853e'),
    ('supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql','4f2faad40fe5002a53279ea98e3595d3770c8af2c18c28f96e3c48c67db3ca61'),
    ('supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql','f41a0e196ff265176dd8aaa7a0ead071de8dc0534b7ac1dca339c39c6e516598')
  ) as required(migration_name,checksum) loop
    select checksum into v_actual from public.r12_schema_migrations where migration_name=v_name;
    if v_actual is distinct from v_expected then raise exception 'Required migration is missing or checksum differs: %',v_name; end if;
  end loop;
  if to_regclass('public.club_paypal_pay_in_3_settings') is null or to_regclass('public.club_paypal_pay_in_3_product_codes') is null or to_regclass('public.club_paypal_pay_in_3_orders') is null then raise exception 'PayPal foundation schema missing; verify/apply 2027-01-03 before this release'; end if;
  for v_name, v_expected in select * from (values
    ('supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql','088c5a60315a09efcc4e64584501b8b5f59f753d00c447fa92030ff16d6a67fd'),
    ('supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql','ae6bcb7e1ac713ed329f9be2809949753b67310dc6c2ce3b00557afe602c853e'),
    ('supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql','4f2faad40fe5002a53279ea98e3595d3770c8af2c18c28f96e3c48c67db3ca61'),
    ('supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql','f41a0e196ff265176dd8aaa7a0ead071de8dc0534b7ac1dca339c39c6e516598')
  ) as included(migration_name,checksum) loop
    select checksum into v_actual from public.r12_schema_migrations where migration_name=v_name;
    if v_actual is not null and v_actual<>v_expected then raise exception 'Included migration checksum differs from ledger: %',v_name; end if;
  end loop;
end $preflight$;

-- BEGIN 2027-01-10-madhouse-pending-staff-assignments.sql
-- Preserve operational staff identity before a person accepts their existing
-- Club invitation. These rows are not Auth users and carry no permissions.
create table if not exists public.club_madhouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  canonical_name text not null check (length(btrim(canonical_name)) between 1 and 120),
  normalized_name text not null,
  location_ids uuid[] not null default '{}',
  staff_grant_id uuid references public.club_staff_access_grants(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organisation_id,normalized_name),
  unique(id,organisation_id)
);
alter table public.club_madhouse_staff_assignments enable row level security;
revoke all on public.club_madhouse_staff_assignments from public,anon,authenticated;
create unique index if not exists club_madhouse_staff_assignment_grant_uq
  on public.club_madhouse_staff_assignments(staff_grant_id) where staff_grant_id is not null;

alter table public.club_madhouse_class_templates add column if not exists instructor_assignment_id uuid;
alter table public.club_class_sessions add column if not exists instructor_assignment_id uuid;
alter table public.club_class_sessions add column if not exists instructor_name_snapshot text;
alter table public.club_staff_rota_shifts add column if not exists staff_assignment_id uuid;
alter table public.club_staff_rota_shifts alter column staff_user_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.club_madhouse_class_templates'::regclass and conname='club_madhouse_template_staff_assignment_fk') then
    alter table public.club_madhouse_class_templates add constraint club_madhouse_template_staff_assignment_fk foreign key(instructor_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_class_sessions'::regclass and conname='club_class_session_staff_assignment_fk') then
    alter table public.club_class_sessions add constraint club_class_session_staff_assignment_fk foreign key(instructor_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_staff_rota_shifts'::regclass and conname='club_staff_rota_assignment_fk') then
    alter table public.club_staff_rota_shifts add constraint club_staff_rota_assignment_fk foreign key(staff_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_staff_rota_shifts'::regclass and conname='club_staff_rota_identity_xor_ck') then
    alter table public.club_staff_rota_shifts add constraint club_staff_rota_identity_xor_ck check ((staff_user_id is not null) <> (staff_assignment_id is not null)) not valid;
    alter table public.club_staff_rota_shifts validate constraint club_staff_rota_identity_xor_ck;
  end if;
end $$;

-- Stable operational identities are intentionally independent of Auth IDs.
insert into public.club_madhouse_staff_assignments(organisation_id,canonical_name,normalized_name,location_ids)
values
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Steve','steve','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Amie','amie','{4a2c01b7-447e-413a-a1a5-1cdef9b24163,06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Keenan','keenan','{4a2c01b7-447e-413a-a1a5-1cdef9b24163,06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Shannon','shannon','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Cody','cody','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Luke','luke','{4a2c01b7-447e-413a-a1a5-1cdef9b24163}')
on conflict(organisation_id,normalized_name) do nothing;
update public.club_madhouse_class_templates t set instructor_assignment_id=a.id
from public.club_madhouse_staff_assignments a where a.organisation_id=t.organisation_id and a.normalized_name=lower(regexp_replace(t.instructor_name,'[^a-z]','','g'))
and t.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb';

create or replace function public.club_madhouse_attach_staff_invitation(p_organisation_id uuid,p_assignment_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare a public.club_madhouse_staff_assignments%rowtype; g public.club_staff_access_grants%rowtype; old_role text; old_coach boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff assignment management is not permitted' using errcode='42501'; end if;
  select * into a from public.club_madhouse_staff_assignments where id=p_assignment_id and organisation_id=p_organisation_id and active for update;
  select * into g from public.club_staff_access_grants where id=p_grant_id and organisation_id=p_organisation_id and status in ('pending','accepted') and (status='accepted' or expires_at>now()) for update;
  if not found or a.id is null then raise exception 'Staff assignment or valid invitation not found' using errcode='P0002'; end if;
  if lower(regexp_replace(split_part(coalesce(g.display_name,''),' ',1),'[^a-z]','','g'))<>a.normalized_name then raise exception 'Invitation name does not match the prepared staff identity' using errcode='22023'; end if;
  if g.status='pending' then
    -- Reuse the invitation/token while preparing the least-privilege Club
    -- staff role and the separately requested Coach permission for this rota.
    old_role:=g.intended_role; old_coach:=g.coach_requested;
    update public.club_staff_access_grants set intended_role='trainer',capabilities=public.club_capabilities_for_role('trainer'),coach_requested=true,location_ids=a.location_ids where id=g.id returning * into g;
  elsif g.intended_role not in ('trainer','gym_admin') or not g.coach_requested or not (a.location_ids <@ g.location_ids) then
    raise exception 'Accepted instructor access does not match the prepared role and locations' using errcode='42501';
  end if;
  update public.club_madhouse_staff_assignments set staff_grant_id=g.id where id=a.id;
  if g.status='accepted' then
    update public.club_class_sessions set host_user_id=g.accepted_by where instructor_assignment_id=a.id and host_user_id is null and starts_at>now();
    update public.club_staff_rota_shifts set staff_user_id=g.accepted_by,staff_assignment_id=null where staff_assignment_id=a.id and work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    select p_organisation_id,auth.uid(),m.role,'staff.operational_identity_linked','staff_assignment',a.id,jsonb_build_object('grant_id',g.id,'status',g.status,'previous_role',old_role,'previous_coach_requested',old_coach,'prepared_role',g.intended_role,'coach_requested',g.coach_requested,'location_ids',g.location_ids) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return jsonb_build_object('assignment_id',a.id,'grant_id',g.id,'status',g.status);
end; $$;
revoke all on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) to authenticated;

create or replace function public.club_madhouse_list_staff_assignments(p_organisation_id uuid)
returns table(assignment_id uuid,canonical_name text,location_ids uuid[],staff_grant_id uuid,grant_status text)
language sql security definer set search_path=pg_catalog,public as $$
  select a.id,a.canonical_name,a.location_ids,a.staff_grant_id,g.status
  from public.club_madhouse_staff_assignments a left join public.club_staff_access_grants g on g.id=a.staff_grant_id
  where a.organisation_id=p_organisation_id and a.active
    and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage')
  order by a.canonical_name
$$;
revoke all on function public.club_madhouse_list_staff_assignments(uuid) from public,anon;
grant execute on function public.club_madhouse_list_staff_assignments(uuid) to authenticated;

-- Claiming an invitation reconciles prepared rota/classes to the real Auth user.
create or replace function public.club_madhouse_reconcile_staff_claim()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='accepted' and old.status is distinct from new.status and new.accepted_by is not null then
    update public.club_class_sessions s set host_user_id=new.accepted_by
      from public.club_madhouse_staff_assignments a where a.staff_grant_id=new.id and s.instructor_assignment_id=a.id and s.host_user_id is null and s.starts_at>now();
    update public.club_staff_rota_shifts r set staff_user_id=new.accepted_by,staff_assignment_id=null
      from public.club_madhouse_staff_assignments a where a.staff_grant_id=new.id and r.staff_assignment_id=a.id and r.work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_staff_claim_reconcile on public.club_staff_access_grants;
create trigger club_madhouse_staff_claim_reconcile after update of status on public.club_staff_access_grants for each row execute function public.club_madhouse_reconcile_staff_claim();

-- Keep generator permission checks. Pending identities are linked only to
-- verified invitation rows created through the existing manager workflow.
create or replace function public.club_madhouse_generate_class_sessions(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_class_templates%rowtype; d date; a public.club_madhouse_staff_assignments%rowtype; staff_id uuid; loc_id uuid; class_type uuid; n integer; created_n integer:=0; exists_n integer:=0; conflict_n integer:=0; start_at timestamptz; sess public.club_class_sessions%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Class schedule management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<greatest((now() at time zone 'Europe/London')::date,date '2026-10-19') or p_to<p_from or p_to-p_from>366 then raise exception 'Choose future class dates in the confirmed timetable window' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_class_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-class:'||t.template_key,0));
    select * into a from public.club_madhouse_staff_assignments where id=t.instructor_assignment_id and organisation_id=p_organisation_id and active;
    if not found then raise exception 'Template % has no verified operational instructor assignment',t.template_key using errcode='55000'; end if;
    staff_id:=null;
    if a.staff_grant_id is not null then
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and g.intended_role in ('trainer','gym_admin') and g.coach_requested and a.normalized_name=lower(regexp_replace(split_part(g.display_name,' ',1),'[^a-z]','','g')) and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Instructor invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=a.normalized_name;
      if n>1 then raise exception 'Instructor identity for % is ambiguous',a.canonical_name using errcode='55000'; end if;
      if n=0 and a.staff_grant_id is null then null; end if;
    end if;
    if cardinality(a.location_ids)=0 then raise exception 'Instructor has no locations assigned' using errcode='55000'; end if;
    select count(*),min(l.id::text)::uuid into n,loc_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name) and l.id=any(a.location_ids);
    if n<>1 then raise exception 'Instructor/location mapping for template % is invalid',t.template_key using errcode='55000'; end if;
    insert into public.club_class_types(organisation_id,name,description,default_duration_minutes,default_capacity) values(p_organisation_id,t.class_name,'Scheduling window up to 60 minutes; actual class duration is not confirmed.',60,6) on conflict(organisation_id,name) do nothing returning id into class_type;
    if class_type is null then select id into class_type from public.club_class_types where organisation_id=p_organisation_id and name=t.class_name and active; end if;
    if class_type is null then raise exception 'Active class type unavailable: %',t.class_name using errcode='55000'; end if;
    for d in select x::date from generate_series(p_from,p_to,interval '1 day') x where extract(isodow from x)=t.weekday loop
      if d<coalesce(t.effective_from,date '2026-10-19') then continue; end if;
      if exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.source_template_key=t.template_key and s.source_template_date=d) then exists_n:=exists_n+1; continue; end if;
      start_at:=(d+t.starts_local) at time zone 'Europe/London'; if start_at<=now() then continue; end if;
      if staff_id is not null and exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.host_user_id=staff_id and s.status='scheduled' and s.starts_at<start_at+interval '60 minutes' and s.ends_at>start_at) then conflict_n:=conflict_n+1; continue; end if;
      insert into public.club_class_sessions(organisation_id,location_id,class_type_id,host_user_id,instructor_assignment_id,instructor_name_snapshot,title,starts_at,ends_at,capacity,max_transformation_credit_bookings,visibility,status,source_template_key,source_template_date)
      values(p_organisation_id,loc_id,class_type,staff_id,a.id,a.canonical_name,t.class_name,start_at,start_at+interval '60 minutes',6,2,'public','scheduled',t.template_key,d) on conflict(organisation_id,source_template_key,source_template_date) where source_template_key is not null do nothing returning * into sess;
      if not found then exists_n:=exists_n+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.class.generated','class_session',sess.id,jsonb_build_object('template_key',t.template_key,'work_date',d,'location_id',loc_id,'host_user_id',staff_id,'instructor_assignment_id',a.id)); created_n:=created_n+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_n,'alreadyGenerated',exists_n,'skippedConflicts',conflict_n,'from',p_from,'to',p_to,'timeZone','Europe/London');
end; $$;
revoke all on function public.club_madhouse_generate_class_sessions(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_class_sessions(uuid,date,date) to authenticated;

create or replace function public.club_madhouse_generate_rota(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_rota_templates%rowtype; d date; a public.club_madhouse_staff_assignments%rowtype; staff_id uuid; loc_id uuid; n integer; created_n integer:=0; exists_n integer:=0; conflict_n integer:=0; sh public.club_staff_rota_shifts%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<(now() at time zone 'Europe/London')::date or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a future rota window of up to one year' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_rota_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    select * into a from public.club_madhouse_staff_assignments where organisation_id=p_organisation_id and normalized_name=lower(regexp_replace(t.staff_name,'[^a-z]','','g')) and active;
    if not found then raise exception 'Rota staff % has no operational identity',t.staff_name using errcode='55000'; end if;
    staff_id:=null;
    if a.staff_grant_id is not null then
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and lower(regexp_replace(split_part(coalesce(g.display_name,''),' ',1),'[^a-z]','','g'))=a.normalized_name and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Staff invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=a.normalized_name;
      if n>1 then raise exception 'Staff identity for % is ambiguous',a.canonical_name using errcode='55000'; end if;
    end if;
    select count(*),min(l.id::text)::uuid into n,loc_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name) and l.id=any(a.location_ids);
    if n<>1 then raise exception 'Staff/location mapping for rota template % is invalid',t.template_key using errcode='55000'; end if;
    for d in select x::date from generate_series(p_from,p_to,interval '1 day') x where extract(isodow from x)=t.weekday loop
      if d<coalesce(t.effective_from,(now() at time zone 'Europe/London')::date) then continue; end if;
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.source_template_key=t.template_key and r.work_date=d) then exists_n:=exists_n+1; continue; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-rota-staff:'||a.id::text||':'||d::text,0));
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.work_date=d and r.status='scheduled' and r.starts_at<t.ends_local and r.ends_at>t.starts_local and ((staff_id is not null and r.staff_user_id=staff_id) or (staff_id is null and r.staff_assignment_id=a.id))) then conflict_n:=conflict_n+1; continue; end if;
      insert into public.club_staff_rota_shifts(organisation_id,staff_user_id,staff_assignment_id,work_date,starts_at,ends_at,location_id,note,created_by,updated_by,source_template_key)
      values(p_organisation_id,staff_id,case when staff_id is null then a.id else null end,d,t.starts_local,t.ends_local,loc_id,'Generated from approved Madhouse weekly rota template',auth.uid(),auth.uid(),t.template_key)
      on conflict(organisation_id,source_template_key,work_date) where source_template_key is not null do nothing returning * into sh;
      if not found then exists_n:=exists_n+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.rota.created','rota_shift',sh.id,jsonb_build_object('staff_user_id',staff_id,'staff_assignment_id',case when staff_id is null then a.id else null end,'work_date',d,'starts_at',t.starts_local,'ends_at',t.ends_local,'location_id',loc_id,'template_key',t.template_key)); created_n:=created_n+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_n,'alreadyGenerated',exists_n,'skippedConflicts',conflict_n,'from',p_from,'to',p_to);
end; $$;
revoke all on function public.club_madhouse_generate_rota(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_rota(uuid,date,date) to authenticated;

-- Keep pending names visible in the existing staff calendar without creating
-- an Auth profile. All former privacy and caller checks remain in force.
create or replace function public.club_list_shared_schedule(p_organisation_id uuid,p_from timestamptz,p_to timestamptz,p_staff_user_id uuid default null,p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare can_view boolean:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage'); can_notes boolean:=public.club_has_active_role(p_organisation_id,array['gym_admin','owner']); manager boolean:=can_notes and can_view;
begin
  if auth.uid() is null or not can_view then raise exception 'Schedule access is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '62 days' then raise exception 'Invalid schedule window' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(x.item order by x.starts_at) from (
    select jsonb_build_object('id',e.id,'leaveRequestId',e.leave_request_id,'eventType',e.event_type,'staffUserId',e.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'PT'),'customerId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.customer_id end,'privateClientId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.private_client_id end,'memberName',case when e.private_client_id is not null then case when can_notes or e.staff_user_id=auth.uid() then pc.display_name end else c.display_name end,'locationId',e.location_id,'locationName',l.name,'externalLocation',e.external_location,'title',case when e.private_client_id is not null and not (can_notes or e.staff_user_id=auth.uid()) then 'PT session' else e.title end,'notes',case when can_notes or e.staff_user_id=auth.uid() then e.internal_notes end,'startsAt',e.starts_at,'endsAt',e.ends_at,'status',e.status) item,e.starts_at
      from public.club_schedule_events e join public.club_members m on m.organisation_id=e.organisation_id and m.user_id=e.staff_user_id and m.active left join public.profiles p on p.id=e.staff_user_id left join public.club_customers c on c.id=e.customer_id and c.organisation_id=e.organisation_id left join public.club_schedule_private_clients pc on pc.id=e.private_client_id and pc.organisation_id=e.organisation_id left join public.club_locations l on l.id=e.location_id and l.organisation_id=e.organisation_id where e.organisation_id=p_organisation_id and e.starts_at<p_to and e.ends_at>p_from and (p_staff_user_id is null or e.staff_user_id=p_staff_user_id) and (p_location_id is null or e.location_id=p_location_id)
    union all
    select jsonb_build_object('id',s.id,'eventType','class','staffUserId',s.host_user_id,'staffName',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),s.instructor_name_snapshot,'Instructor'),'customerId',null,'memberName',null,'locationId',s.location_id,'locationName',l.name,'externalLocation',null,'title',coalesce(s.title,t.name),'description',t.description,'capacity',s.capacity,'notes',null,'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status) item,s.starts_at from public.club_class_sessions s left join public.profiles p on p.id=s.host_user_id left join public.club_locations l on l.id=s.location_id and l.organisation_id=s.organisation_id left join public.club_class_types t on t.id=s.class_type_id and t.organisation_id=s.organisation_id where s.organisation_id=p_organisation_id and s.starts_at<p_to and s.ends_at>p_from and (p_staff_user_id is null or s.host_user_id=p_staff_user_id) and (p_location_id is null or s.location_id=p_location_id)
    union all
    select jsonb_build_object('id',r.id,'eventType','rota_shift','staffUserId',r.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),a.canonical_name,'Staff'),'customerId',null,'memberName',null,'locationId',r.location_id,'locationName',l.name,'externalLocation',null,'title','Rota shift','notes',case when manager then r.note end,'startsAt',(r.work_date+r.starts_at) at time zone 'Europe/London','endsAt',(r.work_date+r.ends_at) at time zone 'Europe/London','status',r.status) item,(r.work_date+r.starts_at) at time zone 'Europe/London' from public.club_staff_rota_shifts r join public.club_locations l on l.id=r.location_id and l.organisation_id=r.organisation_id left join public.profiles p on p.id=r.staff_user_id left join public.club_madhouse_staff_assignments a on a.id=r.staff_assignment_id and a.organisation_id=r.organisation_id where r.organisation_id=p_organisation_id and r.status='scheduled' and (manager or r.staff_user_id=auth.uid()) and r.work_date between (p_from at time zone 'Europe/London')::date and (p_to at time zone 'Europe/London')::date and (p_staff_user_id is null or r.staff_user_id=p_staff_user_id) and (p_location_id is null or r.location_id=p_location_id)
    union all
    select jsonb_build_object('id',q.id,'eventType','leave_request','staffUserId',q.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'Staff'),'customerId',null,'memberName',null,'locationId',null,'locationName',null,'externalLocation',null,'title','Leave request','notes',case when manager or q.staff_user_id=auth.uid() then q.request_note end,'startsAt',q.starts_at,'endsAt',q.ends_at,'status',q.status) item,q.starts_at from public.club_schedule_leave_requests q left join public.profiles p on p.id=q.staff_user_id where q.organisation_id=p_organisation_id and q.status='requested' and (manager or q.staff_user_id=auth.uid()) and q.starts_at<p_to and q.ends_at>p_from and (p_staff_user_id is null or q.staff_user_id=p_staff_user_id)
  ) x),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated;


-- END 2027-01-10-madhouse-pending-staff-assignments.sql

do $record$ declare recorded text; begin
  select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql';
  if recorded is not null and recorded<>'088c5a60315a09efcc4e64584501b8b5f59f753d00c447fa92030ff16d6a67fd' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql'; end if;
  insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql','088c5a60315a09efcc4e64584501b8b5f59f753d00c447fa92030ff16d6a67fd','manual-release-bundle','R12 launch follow-up release') on conflict (migration_name) do nothing;
end $record$;

-- BEGIN 2027-01-11-stripe-membership-subscriptions.sql
-- Stripe-hosted membership subscriptions for new organic joins. This is an
-- additive state-machine migration: it creates no Stripe resources, changes no
-- imported membership, and leaves existing GoCardless/cash arrangements intact.

alter table public.club_membership_join_requests
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_subscription_event_at timestamptz,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_latest_invoice_id text,
  add column if not exists stripe_initial_payment_event_at timestamptz,
  add column if not exists stripe_initial_charge_reversed boolean not null default false,
  add column if not exists stripe_charge_refunded boolean not null default false,
  add column if not exists stripe_dispute_open boolean not null default false,
  add column if not exists stripe_refund_event_at timestamptz,
  add column if not exists stripe_dispute_event_at timestamptz;

create unique index if not exists club_join_stripe_subscription_uq
  on public.club_membership_join_requests(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.club_stripe_membership_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  join_request_id uuid not null,
  provider_event_key text not null,
  attempt_generation integer,
  event_type text not null,
  provider_occurred_at timestamptz not null,
  checkout_session_id text,
  payment_intent_id text,
  customer_id text,
  subscription_id text,
  invoice_id text,
  charge_id text,
  amount_minor integer,
  currency text,
  provider_status text,
  billing_reason text,
  period_start timestamptz,
  period_end timestamptz,
  received_at timestamptz not null default now(),
  unique(provider_event_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
create index if not exists club_stripe_membership_event_refs_idx
  on public.club_stripe_membership_events(subscription_id,invoice_id,charge_id);
alter table public.club_stripe_membership_events enable row level security;
revoke all on table public.club_stripe_membership_events from public,anon,authenticated;

-- The public joining RPC predates Stripe subscriptions. Constrain this trigger
-- to unactivated Madhouse monthly joins, so legacy/imported arrangements cannot
-- be rerouted or re-charged.
create or replace function public.club_route_new_madhouse_monthly_join_to_stripe()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.membership_id is null and new.checkout_kind='monthly_recurring' and exists(
    select 1 from public.club_organisations o where o.id=new.organisation_id and o.slug='madhouse-gym'
  ) then
    new.payment_method:='card'; new.payment_provider:='stripe'; new.upfront_provider:='stripe'; new.recurring_provider:='stripe';
    if new.recurring_authority_state='unavailable' then new.recurring_authority_state:='required'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists club_route_new_madhouse_monthly_join_to_stripe on public.club_membership_join_requests;
create trigger club_route_new_madhouse_monthly_join_to_stripe before insert or update on public.club_membership_join_requests
for each row execute function public.club_route_new_madhouse_monthly_join_to_stripe();
revoke all on function public.club_route_new_madhouse_monthly_join_to_stripe() from public,anon,authenticated;

create or replace function public.club_prepare_stripe_membership_attempt(p_request_id uuid,p_replace_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; c public.club_customers%rowtype; p public.club_products%rowtype; o public.club_organisations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.membership_id is not null or r.status in ('active','completed','cancelled') then raise exception 'Joining attempt is not available' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  select * into c from public.club_customers where id=r.customer_id and organisation_id=r.organisation_id;
  select * into o from public.club_organisations where id=r.organisation_id and active and member_joinable;
  if p.id is null or c.id is null or o.id is null or r.upfront_amount_minor<=0 then raise exception 'Joining attempt is no longer available' using errcode='22023'; end if;
  if r.checkout_kind='monthly_recurring' and (o.slug<>'madhouse-gym' or r.recurring_provider<>'stripe') then raise exception 'Stripe subscription is not available for this join' using errcode='22023'; end if;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') then raise exception 'Stripe checkout is not required' using errcode='22023'; end if;
  if p_replace_reference is not null then
    if r.stripe_checkout_session_id is distinct from p_replace_reference then raise exception 'Stripe checkout changed; resume the current attempt' using errcode='40001'; end if;
    update public.club_membership_join_requests set stripe_checkout_session_id=null,stripe_payment_intent_id=null,
      stripe_customer_id=null,stripe_subscription_id=null,stripe_subscription_status=null,stripe_latest_invoice_id=null,
      stripe_checkout_generation=stripe_checkout_generation+1,upfront_payment_state='pending',
      recurring_authority_state=case when checkout_kind='monthly_recurring' then 'pending' else recurring_authority_state end where id=r.id;
  elsif r.stripe_checkout_generation=0 then
    update public.club_membership_join_requests set stripe_checkout_generation=1 where id=r.id;
  end if;
  update public.club_membership_join_requests set upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'pending' end,
    recurring_authority_state=case when checkout_kind='monthly_recurring' and recurring_authority_state<>'confirmed' then 'pending' else recurring_authority_state end,
    payment_state='pending',status='payment_pending',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'organisation_slug',o.slug,'product_name',p.name,'currency',p.currency,'email',c.email,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'stripe_checkout_session_id',r.stripe_checkout_session_id,
    'stripe_checkout_generation',r.stripe_checkout_generation,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state);
end; $$;
revoke all on function public.club_prepare_stripe_membership_attempt(uuid,text) from public,anon;
grant execute on function public.club_prepare_stripe_membership_attempt(uuid,text) to authenticated;

create or replace function public.club_store_stripe_join_resource(p_request_id uuid,p_checkout_session_id text,p_payment_intent_id text default null,p_customer_id text default null,p_subscription_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  if auth.role()<>'service_role' or p_checkout_session_id!~'^cs_' then raise exception 'Stripe resource update is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if r.stripe_checkout_session_id is not null and r.stripe_checkout_session_id<>p_checkout_session_id then return jsonb_build_object('ignored',true,'reason','superseded_provider_session'); end if;
  update public.club_membership_join_requests set stripe_checkout_session_id=p_checkout_session_id,
    stripe_payment_intent_id=coalesce(nullif(btrim(p_payment_intent_id),''),stripe_payment_intent_id),
    stripe_customer_id=coalesce(nullif(btrim(p_customer_id),''),stripe_customer_id),
    stripe_subscription_id=coalesce(nullif(btrim(p_subscription_id),''),stripe_subscription_id),updated_at=now()
    where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_store_stripe_join_resource(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.club_store_stripe_join_resource(uuid,text,text,text,text) to service_role;

create or replace function public.club_activate_verified_stripe_join(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; v_start timestamptz; v_end timestamptz; v_next timestamptz; v_period text;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe activation is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if r.membership_id is not null then return to_jsonb(r); end if;
  if r.stripe_initial_charge_reversed or r.upfront_payment_state<>'confirmed' or (r.checkout_kind='monthly_recurring' and r.recurring_authority_state<>'confirmed') then return jsonb_build_object('activated',false); end if;
  if r.checkout_kind='monthly_recurring' and (r.stripe_subscription_id is null or r.stripe_customer_id is null or r.stripe_subscription_status not in ('active','trialing')) then return jsonb_build_object('activated',false); end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_start:=coalesce(greatest(r.stripe_initial_payment_event_at,r.stripe_subscription_event_at),r.stripe_initial_payment_event_at,r.stripe_subscription_event_at,now());
  v_end:=case when r.checkout_kind<>'monthly_recurring' and p.duration_days is not null then v_start+make_interval(days=>p.duration_days) end;
  select * into m from public.club_memberships where organisation_id=r.organisation_id and assignment_idempotency_key='join:'||r.id for update;
  if not found then insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
    values(r.organisation_id,p.id,'active',v_start,v_end,'purchase','join:'||r.id) returning * into m; end if;
  insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,r.user_id) on conflict do nothing;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select r.user_id,m.organisation_id,m.id,x.entitlement_key,x.scope,coalesce(x.location_ids,'{}'),x.allowance_quantity,x.allowance_period,x.discount_percent,x.discount_period,x.discount_max_uses,m.starts_at,m.ends_at,m.source
    from public.club_product_entitlements x where x.product_id=p.id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=r.user_id and g.entitlement_key=x.entitlement_key);
  if r.checkout_kind='monthly_recurring' then
    v_next:=coalesce(r.stripe_current_period_end,public.club_membership_anniversary(v_start,r.billing_anchor_day,1));
    insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,billing_anchor_day,last_successful_payment_at,provider_authority_state,collection_status,coverage_paid_through_at,initial_paid_through_at)
      values(r.organisation_id,m.id,r.user_id,r.customer_id,'stripe','recurring_card',r.stripe_customer_id,r.stripe_subscription_id,r.first_period_minor,p.currency,'monthly',v_next,r.billing_anchor_day,v_start,'active','ready',v_next,v_next)
      on conflict(organisation_id,membership_id) do update set provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference returning * into a;
    if a.id is null then select * into a from public.club_membership_billing_arrangements where organisation_id=r.organisation_id and membership_id=m.id; end if;
    v_period:=to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
      values(r.organisation_id,a.id,m.id,r.user_id,r.customer_id,'stripe','recurring_card',r.stripe_customer_id,r.stripe_subscription_id,r.first_period_minor,p.currency,'monthly',v_next,v_period,v_next,public.club_next_membership_billing_due(v_next,'monthly')) on conflict(arrangement_id,period_key) do nothing;
  end if;
  update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',paid_through_at=coalesce(v_end,v_next),completed_at=now(),last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_activate_verified_stripe_join(uuid) from public,anon,authenticated;
grant execute on function public.club_activate_verified_stripe_join(uuid) to service_role;

create or replace function public.club_record_stripe_membership_event(
  p_request_id uuid,p_attempt_generation integer,p_provider_event_key text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text default null,p_payment_intent_id text default null,p_customer_id text default null,p_subscription_id text default null,
  p_invoice_id text default null,p_charge_id text default null,p_amount_minor integer default null,p_currency text default null,
  p_status text default null,p_billing_reason text default null,p_period_start timestamptz default null,p_period_end timestamptz default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; e public.club_stripe_membership_events%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; v_next timestamptz; v_period text; v_full_reversal boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe event is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_provider_event_key),'') is null or p_occurred_at is null or p_event_type not in ('checkout_paid','checkout_failed','subscription_active','subscription_incomplete','subscription_past_due','subscription_cancelled','invoice_paid','invoice_failed','charge_refunded','dispute_opened','dispute_closed') then raise exception 'Invalid Stripe membership event' using errcode='22023'; end if;
  select * into e from public.club_stripe_membership_events where provider_event_key=p_provider_event_key;
  if found then return jsonb_build_object('duplicate',true,'join_request_id',e.join_request_id); end if;
  select * into r from public.club_membership_join_requests j where
    (p_request_id is not null and j.id=p_request_id) or (p_session_id is not null and j.stripe_checkout_session_id=p_session_id) or
    (p_subscription_id is not null and j.stripe_subscription_id=p_subscription_id) or (p_payment_intent_id is not null and j.stripe_payment_intent_id=p_payment_intent_id) or
    (p_invoice_id is not null and (j.stripe_latest_invoice_id=p_invoice_id or exists(select 1 from public.club_stripe_membership_events se where se.join_request_id=j.id and se.invoice_id=p_invoice_id)))
    order by (j.id=p_request_id) desc limit 1 for update;
  if not found then raise exception 'Stripe event cannot be matched to a join request' using errcode='P0002'; end if;
  if p_request_id is not null and r.id<>p_request_id then raise exception 'Stripe metadata does not match the billing resource' using errcode='22023'; end if;
  if (p_attempt_generation is not null and p_attempt_generation<>r.stripe_checkout_generation) or
    (p_attempt_generation is null and p_session_id is distinct from r.stripe_checkout_session_id) or
    (p_session_id is not null and r.stripe_checkout_session_id is not null and r.stripe_checkout_session_id<>p_session_id) or
    (p_subscription_id is not null and r.stripe_subscription_id is not null and r.stripe_subscription_id<>p_subscription_id) or
    (p_customer_id is not null and r.stripe_customer_id is not null and r.stripe_customer_id<>p_customer_id) then
    return jsonb_build_object('ignored',true,'reason','superseded_or_mismatched_stripe_attempt','join_request_id',r.id);
  end if;
  insert into public.club_stripe_membership_events(organisation_id,join_request_id,provider_event_key,attempt_generation,event_type,provider_occurred_at,checkout_session_id,payment_intent_id,customer_id,subscription_id,invoice_id,charge_id,amount_minor,currency,provider_status,billing_reason,period_start,period_end)
    values(r.organisation_id,r.id,p_provider_event_key,p_attempt_generation,p_event_type,p_occurred_at,p_session_id,p_payment_intent_id,p_customer_id,p_subscription_id,p_invoice_id,p_charge_id,p_amount_minor,upper(p_currency),p_status,p_billing_reason,p_period_start,p_period_end) returning * into e;
  update public.club_membership_join_requests set stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_session_id),stripe_payment_intent_id=coalesce(stripe_payment_intent_id,p_payment_intent_id),
    stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),stripe_subscription_id=coalesce(stripe_subscription_id,p_subscription_id),stripe_latest_invoice_id=coalesce(p_invoice_id,stripe_latest_invoice_id),updated_at=now() where id=r.id returning * into r;
  if p_event_type in ('checkout_paid','invoice_paid') and r.membership_id is null and p_amount_minor=r.upfront_amount_minor and upper(p_currency)=(select currency from public.club_products where id=r.product_id) and (p_event_type='checkout_paid' or p_billing_reason='subscription_create' or r.checkout_kind<>'monthly_recurring') then
    if r.stripe_initial_payment_event_at is null or p_occurred_at>=r.stripe_initial_payment_event_at then update public.club_membership_join_requests set upfront_payment_state='confirmed',stripe_initial_payment_event_at=p_occurred_at,stripe_current_period_end=case when checkout_kind='monthly_recurring' then coalesce(p_period_end,stripe_current_period_end) else stripe_current_period_end end,payment_failure_reason=null where id=r.id; end if;
  elsif p_event_type='checkout_failed' and r.upfront_payment_state<>'confirmed' and (r.stripe_event_occurred_at is null or p_occurred_at>=r.stripe_event_occurred_at) then
    update public.club_membership_join_requests set upfront_payment_state='failed',payment_state='failed',status='payment_failed',stripe_event_occurred_at=p_occurred_at,payment_failure_reason='Stripe payment failed or expired' where id=r.id;
  end if;
  if p_event_type like 'subscription_%' and (r.stripe_subscription_event_at is null or p_occurred_at>=r.stripe_subscription_event_at) then
    update public.club_membership_join_requests set stripe_subscription_status=p_status,stripe_subscription_event_at=p_occurred_at,stripe_current_period_end=coalesce(p_period_end,stripe_current_period_end),
      recurring_authority_state=case when p_event_type='subscription_active' then 'confirmed' when p_status='incomplete' then 'pending' else 'failed' end,
      payment_failure_reason=case when p_event_type='subscription_active' or p_status='incomplete' then null else 'Stripe subscription requires attention' end where id=r.id;
  end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.membership_id is null then perform public.club_activate_verified_stripe_join(r.id); end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.membership_id is not null and r.checkout_kind='monthly_recurring' then
    select * into a from public.club_membership_billing_arrangements where organisation_id=r.organisation_id and membership_id=r.membership_id and provider_type='stripe' for update;
    if p_event_type='subscription_active' and (a.mandate_event_occurred_at is null or p_occurred_at>=a.mandate_event_occurred_at) then
      update public.club_membership_billing_arrangements set provider_authority_state='active',collection_status='ready',mandate_event_occurred_at=p_occurred_at,action_required_reason=null,updated_at=now() where id=a.id;
    elsif p_event_type='subscription_cancelled' and (a.mandate_event_occurred_at is null or p_occurred_at>=a.mandate_event_occurred_at) then
      update public.club_membership_billing_arrangements set state='cancelled',provider_authority_state='cancelled',collection_status='blocked',mandate_event_occurred_at=p_occurred_at,action_required_reason='subscription_cancelled',updated_at=now() where id=a.id;
      update public.club_memberships set ends_at=least(coalesce(ends_at,p_period_end,now()),coalesce(p_period_end,now())) where id=r.membership_id and organisation_id=r.organisation_id;
    elsif p_event_type in ('invoice_paid','invoice_failed','subscription_past_due') and p_billing_reason is distinct from 'subscription_create' then
      if p_period_start is not null then
        v_period:=to_char(p_period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
        insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
          values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,'stripe','recurring_card',a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,'monthly',p_period_start,v_period,p_period_start,coalesce(p_period_end,public.club_next_membership_billing_due(p_period_start,'monthly'))) on conflict(arrangement_id,period_key) do nothing;
      end if;
      select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and state not in ('paid','recovered','cancelled','waived')
        and (p_period_start is null or coverage_start_at=p_period_start or next_due_at=p_period_start) order by next_due_at limit 1 for update;
      if found and (o.last_provider_event_at is null or p_occurred_at>=o.last_provider_event_at) then
        if p_event_type='invoice_paid' and p_amount_minor=o.amount_minor and upper(p_currency)=o.currency then
          insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,obligation_id,payload,provider_occurred_at,provider_reference)
            values(r.organisation_id,'stripe',p_provider_event_key,'payment_confirmed',o.id,jsonb_build_object('invoice_id',p_invoice_id),p_occurred_at,p_invoice_id) on conflict do nothing;
          insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key,occurred_at)
            values(r.organisation_id,o.id,p_amount_minor,upper(p_currency),p_invoice_id,p_provider_event_key,p_occurred_at) on conflict do nothing;
          update public.club_membership_billing_obligations set state=case when state in ('failed','grace','overdue') then 'recovered' else 'paid' end,last_paid_at=p_occurred_at,last_payment_reference=p_invoice_id,last_provider_event_at=p_occurred_at,failure_reason=null,grace_started_at=null,updated_at=now() where id=o.id;
          v_next:=coalesce(p_period_end,public.club_next_membership_billing_due(o.next_due_at,'monthly')); v_period:=to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
          if a.next_due_at<=o.next_due_at then
            update public.club_membership_billing_arrangements set next_due_at=v_next,last_successful_payment_at=greatest(coalesce(last_successful_payment_at,p_occurred_at),p_occurred_at),coverage_paid_through_at=greatest(coalesce(coverage_paid_through_at,v_next),v_next),collection_status='ready',action_required_reason=null,updated_at=now() where id=a.id;
          else
            update public.club_membership_billing_arrangements set last_successful_payment_at=greatest(coalesce(last_successful_payment_at,p_occurred_at),p_occurred_at),coverage_paid_through_at=greatest(coalesce(coverage_paid_through_at,v_next),v_next),collection_status='ready',action_required_reason=null,updated_at=now() where id=a.id;
          end if;
          insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
            values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,'stripe','recurring_card',a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,'monthly',v_next,v_period,v_next,public.club_next_membership_billing_due(v_next,'monthly')) on conflict(arrangement_id,period_key) do nothing;
          update public.club_membership_payment_access_suspensions set active=false,cleared_at=now() where obligation_id=o.id and active;
        elsif p_event_type<>'invoice_paid' then update public.club_membership_billing_obligations set state='grace',failure_reason='Stripe recurring payment failed',grace_started_at=coalesce(grace_started_at,p_occurred_at),last_provider_event_at=p_occurred_at,updated_at=now() where id=o.id;
        end if;
      end if;
    end if;
  end if;
  v_full_reversal:=(p_event_type in ('dispute_opened','dispute_closed') and p_status is distinct from 'won' and (r.stripe_dispute_event_at is null or p_occurred_at>=r.stripe_dispute_event_at)) or
    (p_event_type='charge_refunded' and p_amount_minor>=case when r.membership_id is null then r.upfront_amount_minor else r.first_period_minor end and (r.stripe_refund_event_at is null or p_occurred_at>=r.stripe_refund_event_at));
  if v_full_reversal then
    update public.club_membership_join_requests set stripe_initial_charge_reversed=true,
      stripe_charge_refunded=case when p_event_type='charge_refunded' then true else stripe_charge_refunded end,
      stripe_dispute_open=case when p_event_type in ('dispute_opened','dispute_closed') then true else stripe_dispute_open end,
      stripe_refund_event_at=case when p_event_type='charge_refunded' then p_occurred_at else stripe_refund_event_at end,
      stripe_dispute_event_at=case when p_event_type in ('dispute_opened','dispute_closed') then p_occurred_at else stripe_dispute_event_at end,
      payment_state='failed',payment_failure_reason=case when p_event_type='charge_refunded' then 'Stripe payment refunded' else 'Stripe payment disputed' end,updated_at=now() where id=r.id;
    if r.membership_id is not null then
      if a.id is null then insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,state)
        values(r.organisation_id,r.membership_id,r.user_id,r.customer_id,'stripe','other',greatest(r.first_period_minor,1),(select currency from public.club_products where id=r.product_id),'other',p_occurred_at,'cancelled') returning * into a; end if;
      insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key,state,failure_reason)
        values(r.organisation_id,a.id,r.membership_id,r.user_id,r.customer_id,'stripe',a.payment_method_family,greatest(r.first_period_minor,1),a.currency,a.frequency,p_occurred_at,'reversal:'||r.id,'overdue',case when p_event_type='charge_refunded' then 'Payment refunded' else 'Payment disputed' end)
        on conflict(arrangement_id,period_key) do update set state='overdue',failure_reason=excluded.failure_reason returning * into o;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id,reason) values(r.organisation_id,r.membership_id,r.user_id,o.id,'payment_reversed') on conflict(obligation_id) do update set active=true,cleared_at=null,reason='payment_reversed';
    end if;
  elsif p_event_type='dispute_closed' and p_status='won' and (r.stripe_dispute_event_at is null or p_occurred_at>=r.stripe_dispute_event_at) then
    update public.club_membership_join_requests set stripe_dispute_open=false,stripe_dispute_event_at=p_occurred_at,
      stripe_initial_charge_reversed=stripe_charge_refunded,payment_state=case when stripe_charge_refunded then 'failed' else 'confirmed' end,
      payment_failure_reason=case when stripe_charge_refunded then 'Stripe payment refunded' else null end,updated_at=now() where id=r.id returning * into r;
    if not r.stripe_charge_refunded then update public.club_membership_payment_access_suspensions s set active=false,cleared_at=now() from public.club_membership_billing_obligations ob where s.obligation_id=ob.id and ob.period_key='reversal:'||r.id and s.active; end if;
  end if;
  return jsonb_build_object('recorded',true,'join_request_id',r.id,'event_type',p_event_type);
end; $$;
revoke all on function public.club_record_stripe_membership_event(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_stripe_membership_event(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz) to service_role;
-- END 2027-01-11-stripe-membership-subscriptions.sql

do $record$ declare recorded text; begin
  select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql';
  if recorded is not null and recorded<>'ae6bcb7e1ac713ed329f9be2809949753b67310dc6c2ce3b00557afe602c853e' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql'; end if;
  insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql','ae6bcb7e1ac713ed329f9be2809949753b67310dc6c2ce3b00557afe602c853e','manual-release-bundle','R12 launch follow-up release') on conflict (migration_name) do nothing;
end $record$;

-- BEGIN 2027-01-12-two-stripe-merchant-isolation.sql
-- Split Madhouse Stripe processing by legal merchant and keep the gym join
-- product cross-site. This migration only adds reviewed application state; it
-- creates no Stripe resources and changes no existing payments or members.

alter table public.club_commerce_products
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text;
do $$ begin
  alter table public.club_commerce_products add constraint club_commerce_products_stripe_route_ck
    check ((stripe_merchant_entity is null and stripe_product_id is null and stripe_price_id is null)
      or (stripe_merchant_entity='madhouse_products_services'
        and stripe_product_id is not null and stripe_product_id ~ '^prod_[A-Za-z0-9]+$'
        and stripe_price_id is not null and stripe_price_id ~ '^price_[A-Za-z0-9]+$'));
exception when duplicate_object then null;
end $$;

alter table public.club_payment_attempts
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_intent_id text;
do $$ begin
  alter table public.club_payment_attempts add constraint club_payment_attempts_stripe_entity_ck
    check (stripe_merchant_entity is null or stripe_merchant_entity='madhouse_products_services');
exception when duplicate_object then null;
end $$;
create unique index if not exists club_payment_attempts_stripe_session_uq
  on public.club_payment_attempts(stripe_account_id,stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists club_payment_attempts_stripe_intent_uq
  on public.club_payment_attempts(stripe_account_id,stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.club_payments
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_dispute_state text not null default 'none',
  add column if not exists stripe_refunded_minor integer not null default 0,
  add column if not exists stripe_last_refund_at timestamptz,
  add column if not exists stripe_last_dispute_at timestamptz;
do $$ begin
  alter table public.club_payments add constraint club_payments_stripe_entity_ck
    check (stripe_merchant_entity is null or stripe_merchant_entity='madhouse_products_services');
  alter table public.club_payments add constraint club_payments_stripe_dispute_ck
    check (stripe_dispute_state in ('none','open','won','lost','warning_closed'));
  alter table public.club_payments add constraint club_payments_stripe_refunded_ck
    check (stripe_refunded_minor>=0 and stripe_refunded_minor<=amount_minor);
exception when duplicate_object then null;
end $$;

create table if not exists public.club_stripe_commerce_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_key text not null unique,
  merchant_entity text not null check (merchant_entity='madhouse_products_services'),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  organisation_id uuid not null,
  payment_attempt_id uuid not null,
  order_id uuid not null,
  event_type text not null check (event_type in ('checkout_pending','checkout_paid','checkout_failed','checkout_expired','charge_refunded','dispute_opened','dispute_closed')),
  provider_occurred_at timestamptz not null,
  checkout_session_id text,
  payment_intent_id text,
  customer_id text,
  amount_minor integer,
  refunded_minor integer,
  currency text,
  provider_status text,
  received_at timestamptz not null default now(),
  foreign key (payment_attempt_id,organisation_id) references public.club_payment_attempts(id,organisation_id) on delete restrict,
  foreign key (order_id,organisation_id) references public.club_orders(id,organisation_id) on delete restrict
);
create index if not exists club_stripe_commerce_events_attempt_idx
  on public.club_stripe_commerce_events(payment_attempt_id,provider_occurred_at desc);
alter table public.club_stripe_commerce_events enable row level security;
revoke all on table public.club_stripe_commerce_events from public,anon,authenticated;

-- A legal merchant and exact Stripe Product/Price references are explicit
-- catalogue data. No category, gym site, client field, or imported supplier row
-- is allowed to imply that Products and Services owns a sale.
create or replace function public.club_set_commerce_stripe_route(
  p_organisation_id uuid,p_product_id uuid,p_merchant_entity text,p_stripe_product_id text,p_stripe_price_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_commerce_products%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
    raise exception 'Stripe product routing is not permitted' using errcode='42501';
  end if;
  if p_merchant_entity is null then
    if p_stripe_product_id is not null or p_stripe_price_id is not null then raise exception 'Clear Stripe references with the merchant route' using errcode='22023'; end if;
  elsif p_merchant_entity<>'madhouse_products_services'
    or p_stripe_product_id !~ '^prod_[A-Za-z0-9]+$' or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception 'Only a verified Products and Services route with exact Stripe references can be saved' using errcode='22023';
  end if;
  update public.club_commerce_products set stripe_merchant_entity=p_merchant_entity,
    stripe_product_id=p_stripe_product_id,stripe_price_id=p_stripe_price_id,updated_at=now()
    where id=p_product_id and organisation_id=p_organisation_id returning * into p;
  if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'commerce.stripe_route_changed','commerce_product',p.id,
      jsonb_build_object('merchant_entity',p_merchant_entity,'stripe_product_id',p_stripe_product_id,'stripe_price_id',p_stripe_price_id));
  return to_jsonb(p);
end; $$;
revoke all on function public.club_set_commerce_stripe_route(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.club_set_commerce_stripe_route(uuid,uuid,text,text,text) to authenticated;

-- The server action derives merchant ownership from every database product in
-- the basket. It creates the normal order/reservation/payment-attempt records in
-- one transaction and rejects unknown, mixed, discounted, or unconfigured rows.
create or replace function public.club_begin_stripe_commerce_attempt(
  p_organisation_id uuid,p_location_id uuid,p_items jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare order_result jsonb; o public.club_orders%rowtype; a jsonb; v_attempt public.club_payment_attempts%rowtype; item record; v_expected integer:=0;
begin
  if auth.uid() is null or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Payment attempt is not valid' using errcode='42501'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Basket is empty' using errcode='22023'; end if;
  for item in select (value->>'product_id')::uuid product_id,(value->>'quantity')::integer quantity
    from jsonb_array_elements(p_items) loop
    if item.quantity is null or item.quantity<1 or item.quantity>50 or not exists(select 1 from public.club_commerce_products p
      where p.id=item.product_id and p.organisation_id=p_organisation_id and p.active
        and p.stripe_merchant_entity='madhouse_products_services'
        and p.stripe_product_id is not null and p.stripe_price_id is not null
        and 'online'=any(p.sales_channels)) then
      raise exception 'Every basket item needs one confirmed Products and Services Stripe route' using errcode='22023';
    end if;
    select v_expected+(p.sell_price_minor*item.quantity) into v_expected from public.club_commerce_products p where p.id=item.product_id and p.organisation_id=p_organisation_id;
  end loop;
  order_result:=public.club_create_commerce_order(p_organisation_id,p_location_id,null,'member_app','GBP',p_items,p_idempotency_key);
  select * into o from public.club_orders where id=(order_result->'order'->>'id')::uuid for update;
  if o.discount_minor<>0 or o.total_minor<>v_expected then raise exception 'Stripe checkout is unavailable for discounted or changed basket totals' using errcode='22023'; end if;
  perform public.club_reserve_order_stock(o.id);
  a:=public.club_create_payment_attempt(p_organisation_id,o.id,0,'card',o.total_minor,p_idempotency_key||':stripe');
  select * into v_attempt from public.club_payment_attempts where id=(a->'attempt'->>'id')::uuid for update;
  if v_attempt.stripe_merchant_entity is not null and v_attempt.stripe_merchant_entity<>'madhouse_products_services' then raise exception 'Payment attempt merchant mismatch' using errcode='22023'; end if;
  update public.club_payment_attempts set stripe_merchant_entity='madhouse_products_services' where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('order',to_jsonb(o),'attempt',to_jsonb(v_attempt),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'stripe_product_id',p.stripe_product_id,
      'stripe_price_id',p.stripe_price_id,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,
      'currency',o.currency) order by i.id),'[]'::jsonb) from public.club_order_items i
      join public.club_commerce_products p on p.id=i.product_id and p.organisation_id=i.organisation_id where i.order_id=o.id));
end; $$;
revoke all on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.club_bind_stripe_commerce_account(p_attempt_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype;
begin
  if auth.role()<>'service_role' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Stripe account binding is not permitted' using errcode='42501'; end if;
  update public.club_payment_attempts set stripe_account_id=p_account_id,updated_at=now()
    where id=p_attempt_id and status='pending' and stripe_merchant_entity='madhouse_products_services'
      and (stripe_account_id is null or stripe_account_id=p_account_id) returning * into a;
  if not found then raise exception 'Stripe commerce attempt is not available' using errcode='P0002'; end if;
  return to_jsonb(a);
end; $$;
revoke all on function public.club_bind_stripe_commerce_account(uuid,text) from public,anon,authenticated;
grant execute on function public.club_bind_stripe_commerce_account(uuid,text) to service_role;

create or replace function public.club_store_stripe_commerce_session(
  p_attempt_id uuid,p_account_id text,p_session_id text,p_customer_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype;
begin
  if auth.role()<>'service_role' or p_session_id !~ '^cs_' or p_account_id !~ '^acct_[A-Za-z0-9]+$'
    or (p_customer_id is not null and p_customer_id !~ '^cus_') then raise exception 'Stripe session is not valid' using errcode='42501'; end if;
  update public.club_payment_attempts set stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_session_id),
    stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),updated_at=now()
    where id=p_attempt_id and status='pending' and stripe_merchant_entity='madhouse_products_services'
      and stripe_account_id=p_account_id and (stripe_checkout_session_id is null or stripe_checkout_session_id=p_session_id)
    returning * into a;
  if not found then raise exception 'Stripe session does not match the pending Products and Services attempt' using errcode='22023'; end if;
  return to_jsonb(a);
end; $$;
revoke all on function public.club_store_stripe_commerce_session(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.club_store_stripe_commerce_session(uuid,text,text,text) to service_role;

create or replace function public.club_abort_stripe_commerce_attempt(p_attempt_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; o public.club_orders%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe attempt abort is not permitted' using errcode='42501'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id and stripe_merchant_entity='madhouse_products_services' for update;
  if not found then raise exception 'Stripe attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then raise exception 'Paid Stripe attempt cannot be aborted' using errcode='22023'; end if;
  update public.club_payment_attempts set status='failed',failure_reason=left(nullif(btrim(p_reason),''),240),updated_at=now() where id=a.id returning * into a;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=a.id and status='held';
  update public.club_orders set status='cancelled',updated_at=now() where id=a.order_id and status='pending_payment' returning * into o;
  return jsonb_build_object('attempt',to_jsonb(a),'order',to_jsonb(o));
end; $$;
revoke all on function public.club_abort_stripe_commerce_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.club_abort_stripe_commerce_attempt(uuid,text) to service_role;

create or replace function public.club_get_stripe_commerce_checkout_resume(p_attempt_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; o public.club_orders%rowtype;
begin
  if auth.role()<>'service_role' or p_user_id is null then raise exception 'Stripe checkout lookup is not permitted' using errcode='42501'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id and user_id=p_user_id
    and stripe_merchant_entity='madhouse_products_services' for update;
  if not found then raise exception 'Stripe checkout was not found' using errcode='P0002'; end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id and user_id=p_user_id;
  if not found then raise exception 'Stripe order was not found' using errcode='P0002'; end if;
  return jsonb_build_object('attempt',to_jsonb(a),'order',to_jsonb(o));
end; $$;
revoke all on function public.club_get_stripe_commerce_checkout_resume(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_stripe_commerce_checkout_resume(uuid,uuid) to service_role;

create or replace function public.club_record_stripe_commerce_event(
  p_event_id text,p_attempt_id uuid,p_merchant_entity text,p_account_id text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text default null,p_payment_intent_id text default null,p_customer_id text default null,
  p_amount_minor integer default null,p_refunded_minor integer default null,p_currency text default null,p_status text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; o public.club_orders%rowtype; prior public.club_stripe_commerce_events%rowtype; payment public.club_payments%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe commerce event is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_event_id),'') is null or p_occurred_at is null
    or p_merchant_entity<>'madhouse_products_services' or p_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_event_type not in ('checkout_pending','checkout_paid','checkout_failed','checkout_expired','charge_refunded','dispute_opened','dispute_closed') then
    raise exception 'Stripe commerce event is invalid' using errcode='22023';
  end if;
  select * into prior from public.club_stripe_commerce_events where provider_event_key=p_event_id;
  if found then return jsonb_build_object('duplicate',true); end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found or a.stripe_merchant_entity<>p_merchant_entity or a.stripe_account_id is distinct from p_account_id then
    raise exception 'Stripe event merchant does not match its payment attempt' using errcode='42501';
  end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found then raise exception 'Stripe order is missing' using errcode='P0002'; end if;
  if p_session_id is not null and a.stripe_checkout_session_id is distinct from p_session_id then
    raise exception 'Stripe Checkout session does not match its payment attempt' using errcode='22023';
  end if;
  if p_payment_intent_id is not null and a.stripe_payment_intent_id is not null and a.stripe_payment_intent_id<>p_payment_intent_id then
    raise exception 'Stripe PaymentIntent does not match its payment attempt' using errcode='22023';
  end if;
  if p_event_type in ('checkout_pending','checkout_paid','checkout_failed','checkout_expired') then
    if (p_session_id is null and not (p_event_type='checkout_failed' and p_payment_intent_id is not null))
      or p_session_id is not null and a.stripe_checkout_session_id is distinct from p_session_id
      or p_amount_minor is distinct from a.external_amount_minor or p_currency is null or upper(p_currency)<>o.currency then
      raise exception 'Stripe checkout amount, currency or session does not match' using errcode='22023';
    end if;
  elsif p_payment_intent_id is null then
    raise exception 'Stripe reversal has no PaymentIntent reference' using errcode='22023';
  end if;
  insert into public.club_stripe_commerce_events(provider_event_key,merchant_entity,stripe_account_id,organisation_id,payment_attempt_id,order_id,event_type,provider_occurred_at,checkout_session_id,payment_intent_id,customer_id,amount_minor,refunded_minor,currency,provider_status)
    values(p_event_id,p_merchant_entity,p_account_id,a.organisation_id,a.id,o.id,p_event_type,p_occurred_at,p_session_id,p_payment_intent_id,p_customer_id,p_amount_minor,p_refunded_minor,upper(p_currency),p_status);
  update public.club_payment_attempts set stripe_payment_intent_id=coalesce(stripe_payment_intent_id,p_payment_intent_id),
    stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),updated_at=now() where id=a.id returning * into a;
  if p_event_type='checkout_paid' then
    if p_status is distinct from 'paid' or p_payment_intent_id is null or p_customer_id is null or p_amount_minor<>a.external_amount_minor then
      return jsonb_build_object('ignored',true,'reason','checkout_not_fully_paid');
    end if;
    perform public.club_capture_payment_attempt(a.id,p_payment_intent_id);
    update public.club_payments set stripe_merchant_entity=p_merchant_entity,stripe_account_id=p_account_id
      where organisation_id=a.organisation_id and external_reference=p_payment_intent_id returning * into payment;
  elsif p_event_type in ('checkout_failed','checkout_expired') and a.status='pending' then
    update public.club_payment_attempts set status=case when p_event_type='checkout_expired' then 'cancelled' else 'failed' end,
      failure_reason=case when p_event_type='checkout_expired' then 'Stripe Checkout expired' else 'Stripe payment failed' end,updated_at=now()
      where id=a.id returning * into a;
    update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=a.id and status='held';
    update public.club_orders set status='cancelled',updated_at=now() where id=o.id and status='pending_payment';
  elsif p_event_type in ('charge_refunded','dispute_opened','dispute_closed') then
    select * into payment from public.club_payments where organisation_id=a.organisation_id and external_reference=p_payment_intent_id for update;
    if not found or payment.stripe_merchant_entity<>p_merchant_entity or payment.stripe_account_id<>p_account_id then
      raise exception 'Stripe reversal is not linked to a Products and Services payment' using errcode='42501';
    end if;
    if p_amount_minor is distinct from payment.amount_minor or p_currency is null or upper(p_currency)<>payment.currency then
      raise exception 'Stripe reversal amount or currency does not match the payment' using errcode='22023';
    end if;
    if p_event_type='charge_refunded' then
      if p_refunded_minor is null or p_refunded_minor<0 or p_refunded_minor>payment.amount_minor then raise exception 'Stripe refund amount is invalid' using errcode='22023'; end if;
      if payment.stripe_last_refund_at is null or p_occurred_at>=payment.stripe_last_refund_at then
        update public.club_payments set stripe_refunded_minor=p_refunded_minor,stripe_last_refund_at=p_occurred_at,
          status=case when p_refunded_minor=amount_minor then 'refunded' when p_refunded_minor>0 then 'partially_refunded' else status end,updated_at=now()
          where id=payment.id;
        if p_refunded_minor=payment.amount_minor then update public.club_orders set status='refunded',updated_at=now() where id=o.id and status in ('paid','fulfilled'); end if;
      end if;
    elsif p_event_type='dispute_opened' and (payment.stripe_last_dispute_at is null or p_occurred_at>=payment.stripe_last_dispute_at) then
      update public.club_payments set stripe_dispute_state='open',stripe_last_dispute_at=p_occurred_at,updated_at=now() where id=payment.id;
    elsif p_event_type='dispute_closed' and (payment.stripe_last_dispute_at is null or p_occurred_at>=payment.stripe_last_dispute_at) then
      update public.club_payments set stripe_dispute_state=case when p_status='won' then 'won' when p_status='warning_closed' then 'warning_closed' else 'lost' end,stripe_last_dispute_at=p_occurred_at,updated_at=now() where id=payment.id;
    end if;
  end if;
  return jsonb_build_object('duplicate',false,'status',a.status,'order_id',o.id);
end; $$;
revoke all on function public.club_record_stripe_commerce_event(text,uuid,text,text,text,timestamptz,text,text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.club_record_stripe_commerce_event(text,uuid,text,text,text,timestamptz,text,text,text,integer,integer,text,text) to service_role;

-- New Madhouse online joins may omit their home-gym preference. The existing
-- verified join workflow remains canonical and performs the same age/identity/
-- billing checks; a temporary active venue is cleared in this transaction.
create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,
    'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'sellable',p.sellable,
    'joining_fee_minor',case when p.billing='recurring' or (o.slug='madhouse-gym' and p.duration_days>=365) then coalesce(charges.joining_fee_minor,0) else 0 end,
    'joining_fee_configured',case when p.price_minor=0 or not (p.billing='recurring' or (o.slug='madhouse-gym' and p.duration_days>=365)) then true else coalesce(charges.configured,false) end,
    'checkout_kind',case when p.price_minor=0 then 'free' when p.billing='recurring' then 'monthly_recurring'
      when p.duration_days=1 then 'day_pass' when p.duration_days=7 then 'week_pass'
      when p.duration_days>=365 then 'annual_one_off' else 'one_off' end
  )
  from public.club_products p join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  left join lateral (
    select sum(c.amount_minor)::integer joining_fee_minor,count(*)>0 configured from public.club_membership_initial_charges c
    where c.organisation_id=p.organisation_id and c.product_id=p.id and c.charge_type='joining_fee' and c.required and c.active
  ) charges on true
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
    and (o.slug<>'madhouse-gym' or p.price_minor>0)
  order by p.name;
$$;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

create or replace function public.club_start_membership_joining_optional_home_location(
  p_organisation_id uuid,p_product_id uuid,p_home_location_id uuid,p_first_name text,p_last_name text,
  p_email text,p_phone text,p_date_of_birth date,p_address_line_1 text,p_address_line_2 text,
  p_town_city text,p_postcode text,p_emergency_name text,p_emergency_phone text,
  p_terms_accepted boolean,p_privacy_accepted boolean,p_marketing_consent boolean,
  p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location uuid; result jsonb; request_id uuid; r public.club_membership_join_requests%rowtype; v_joining_fee integer; v_fee_configured boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if exists(select 1 from public.club_organisations where id=p_organisation_id and slug='madhouse-gym')
    and not exists(select 1 from public.club_products where id=p_product_id and organisation_id=p_organisation_id and sellable and archived_at is null and price_minor>0) then
    raise exception 'Madhouse memberships require a configured paid plan' using errcode='22023';
  end if;
  if p_home_location_id is not null and not exists(select 1 from public.club_locations where id=p_home_location_id and organisation_id=p_organisation_id and active) then
    raise exception 'Home gym preference is unavailable' using errcode='22023';
  end if;
  v_location:=p_home_location_id;
  if v_location is null then select id into v_location from public.club_locations where organisation_id=p_organisation_id and active order by name,id limit 1; end if;
  if v_location is null then raise exception 'Joining is unavailable' using errcode='55000'; end if;
  select * into r from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=auth.uid()
    and status not in ('completed','cancelled') for update;
  if found and (r.membership_id is not null or r.stripe_checkout_generation>0 or r.stripe_checkout_session_id is not null) then
    raise exception 'An existing joining attempt must be resumed rather than replaced' using errcode='40001';
  end if;
  result:=public.club_start_membership_joining(p_organisation_id,p_product_id,v_location,p_first_name,p_last_name,
    p_email,p_phone,p_date_of_birth,p_address_line_1,p_address_line_2,p_town_city,p_postcode,p_emergency_name,p_emergency_phone,
    p_terms_accepted,p_privacy_accepted,p_marketing_consent,p_payment_method,p_idempotency_key);
  request_id:=(result->'request'->>'id')::uuid;
  select * into r from public.club_membership_join_requests where id=request_id for update;
  if r.checkout_kind='annual_one_off' and exists(select 1 from public.club_organisations where id=p_organisation_id and slug='madhouse-gym') then
    select coalesce(sum(amount_minor),0)::integer,count(*)>0 into v_joining_fee,v_fee_configured from public.club_membership_initial_charges
      where organisation_id=p_organisation_id and product_id=p_product_id and charge_type='joining_fee' and required and active;
    if not v_fee_configured then raise exception 'Annual Madhouse joining fee is not configured' using errcode='55000'; end if;
    if r.stripe_checkout_generation>0 or r.stripe_checkout_session_id is not null then
      if r.joining_fee_minor<>v_joining_fee then raise exception 'Joining fee changed after Stripe checkout began; contact Madhouse support' using errcode='40001'; end if;
    else
      update public.club_membership_join_requests set joining_fee_minor=v_joining_fee,
        upfront_amount_minor=first_period_minor+v_joining_fee,updated_at=now() where id=r.id returning * into r;
      result:=jsonb_set(result,'{request}',to_jsonb(r),true);
    end if;
  end if;
  if p_home_location_id is null then
    update public.club_members set preferred_location_id=null where organisation_id=p_organisation_id and user_id=auth.uid();
    update public.club_membership_join_requests set location_id=null where id=request_id returning * into r;
    result:=jsonb_set(result,'{request}',to_jsonb(r),true);
  end if;
  return result;
end; $$;
revoke all on function public.club_start_membership_joining_optional_home_location(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.club_start_membership_joining_optional_home_location(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon,authenticated;

-- New Madhouse join entitlements are organisation-wide across Rotherham and
-- Carlton. The user's optional home location remains only a preference.
create or replace function public.club_normalize_join_gym_entitlement_scope()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.entitlement_key='gym_access' and new.membership_id is not null and exists(
    select 1 from public.club_memberships m join public.club_organisations o on o.id=m.organisation_id
    where m.id=new.membership_id and m.assignment_idempotency_key like 'join:%' and o.slug='madhouse-gym'
  ) then
    new.scope:='organisation'; new.location_ids:='{}';
  end if;
  return new;
end; $$;
revoke all on function public.club_normalize_join_gym_entitlement_scope() from public,anon,authenticated;
drop trigger if exists club_normalize_join_gym_entitlement_scope on public.club_entitlement_grants;
create trigger club_normalize_join_gym_entitlement_scope before insert or update of scope,location_ids on public.club_entitlement_grants
for each row execute function public.club_normalize_join_gym_entitlement_scope();

-- Bind new organic membership sessions and their durable events to the exact
-- Franchise Stripe account. Products & Services webhook credentials cannot
-- fulfil a membership obligation, even if an event carries matching metadata.
alter table public.club_membership_join_requests
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text;
alter table public.club_stripe_membership_events
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text;
create unique index if not exists club_join_stripe_account_session_uq
  on public.club_membership_join_requests(stripe_account_id,stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists club_join_stripe_account_intent_uq
  on public.club_membership_join_requests(stripe_account_id,stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create or replace function public.club_prepare_stripe_membership_attempt(p_request_id uuid,p_replace_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; c public.club_customers%rowtype; p public.club_products%rowtype; o public.club_organisations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.membership_id is not null or r.status in ('active','completed','cancelled') then raise exception 'Joining attempt is not available' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  select * into c from public.club_customers where id=r.customer_id and organisation_id=r.organisation_id;
  select * into o from public.club_organisations where id=r.organisation_id and active and member_joinable;
  if p.id is null or c.id is null or o.id is null or r.upfront_amount_minor<=0 then raise exception 'Joining attempt is no longer available' using errcode='22023'; end if;
  if r.checkout_kind='monthly_recurring' and (o.slug<>'madhouse-gym' or r.recurring_provider<>'stripe') then raise exception 'Stripe subscription is not available for this join' using errcode='22023'; end if;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') then raise exception 'Stripe checkout is not required' using errcode='22023'; end if;
  if p_replace_reference is not null then
    if r.stripe_checkout_session_id is distinct from p_replace_reference then raise exception 'Stripe checkout changed; resume the current attempt' using errcode='40001'; end if;
    update public.club_membership_join_requests set stripe_checkout_session_id=null,stripe_payment_intent_id=null,
      stripe_customer_id=null,stripe_subscription_id=null,stripe_subscription_status=null,stripe_latest_invoice_id=null,
      stripe_checkout_generation=stripe_checkout_generation+1,upfront_payment_state='pending',
      recurring_authority_state=case when checkout_kind='monthly_recurring' then 'pending' else recurring_authority_state end where id=r.id;
  elsif r.stripe_checkout_generation=0 then
    update public.club_membership_join_requests set stripe_checkout_generation=1 where id=r.id;
  end if;
  update public.club_membership_join_requests set upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'pending' end,
    recurring_authority_state=case when checkout_kind='monthly_recurring' and recurring_authority_state<>'confirmed' then 'pending' else recurring_authority_state end,
    payment_state='pending',status='payment_pending',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'membership_product_id',p.id,'organisation_slug',o.slug,'product_name',p.name,'currency',p.currency,'email',c.email,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'stripe_checkout_session_id',r.stripe_checkout_session_id,
    'stripe_checkout_generation',r.stripe_checkout_generation,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state);
end; $$;
revoke all on function public.club_prepare_stripe_membership_attempt(uuid,text) from public,anon;
grant execute on function public.club_prepare_stripe_membership_attempt(uuid,text) to authenticated;

create or replace function public.club_bind_stripe_join_account(p_request_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  if auth.role()<>'service_role' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Stripe membership account binding is not permitted' using errcode='42501'; end if;
  update public.club_membership_join_requests set stripe_merchant_entity='madhouse_franchise',stripe_account_id=coalesce(stripe_account_id,p_account_id),updated_at=now()
    where id=p_request_id and membership_id is null and status not in ('active','cancelled')
      and (stripe_merchant_entity is null or stripe_merchant_entity='madhouse_franchise')
      and (stripe_account_id is null or stripe_account_id=p_account_id) returning * into r;
  if not found then raise exception 'Stripe joining attempt is unavailable or bound to another account' using errcode='22023'; end if;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_bind_stripe_join_account(uuid,text) from public,anon,authenticated;
grant execute on function public.club_bind_stripe_join_account(uuid,text) to service_role;

create or replace function public.club_record_stripe_membership_event_for_account(
  p_request_id uuid,p_attempt_generation integer,p_provider_event_key text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text,p_payment_intent_id text,p_customer_id text,p_subscription_id text,p_invoice_id text,p_charge_id text,
  p_amount_minor integer,p_currency text,p_status text,p_billing_reason text,p_period_start timestamptz,p_period_end timestamptz,
  p_merchant_entity text,p_account_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; result jsonb;
begin
  if auth.role()<>'service_role' or p_merchant_entity<>'madhouse_franchise' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'Stripe membership merchant is not permitted' using errcode='42501';
  end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found or r.stripe_merchant_entity is distinct from p_merchant_entity or r.stripe_account_id is distinct from p_account_id then
    raise exception 'Stripe event account does not match the joining account' using errcode='42501';
  end if;
  if (p_session_id is not null and r.stripe_checkout_session_id is distinct from p_session_id)
    or (p_customer_id is not null and r.stripe_customer_id is not null and r.stripe_customer_id<>p_customer_id)
    or (p_subscription_id is not null and r.stripe_subscription_id is not null and r.stripe_subscription_id<>p_subscription_id)
    or (p_attempt_generation is not null and p_attempt_generation<>r.stripe_checkout_generation) then
    raise exception 'Stripe resource does not match the current joining attempt' using errcode='22023';
  end if;
  result:=public.club_record_stripe_membership_event(p_request_id,p_attempt_generation,p_provider_event_key,p_event_type,p_occurred_at,
    p_session_id,p_payment_intent_id,p_customer_id,p_subscription_id,p_invoice_id,p_charge_id,p_amount_minor,p_currency,p_status,p_billing_reason,p_period_start,p_period_end);
  update public.club_stripe_membership_events set stripe_merchant_entity=p_merchant_entity,stripe_account_id=p_account_id
    where provider_event_key=p_provider_event_key;
  return result;
end; $$;
revoke all on function public.club_record_stripe_membership_event_for_account(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.club_record_stripe_membership_event_for_account(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz,text,text) to service_role;
-- END 2027-01-12-two-stripe-merchant-isolation.sql

do $record$ declare recorded text; begin
  select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql';
  if recorded is not null and recorded<>'4f2faad40fe5002a53279ea98e3595d3770c8af2c18c28f96e3c48c67db3ca61' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql'; end if;
  insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql','4f2faad40fe5002a53279ea98e3595d3770c8af2c18c28f96e3c48c67db3ca61','manual-release-bundle','R12 launch follow-up release') on conflict (migration_name) do nothing;
end $record$;

-- BEGIN 2027-01-13-paypal-pay-in-3-checkout.sql
-- PayPal Pay in 3 one-off checkout and reconciliation. It is fully gated by
-- the environment and merchant approval fields; this migration creates no
-- provider objects, charges, accounts, or membership rows.

alter table public.club_membership_join_requests
  drop constraint if exists club_join_payment_method_check;
alter table public.club_membership_join_requests
  add constraint club_join_payment_method_check
  check(payment_method is null or payment_method in ('none','card','direct_debit','card_and_direct_debit','staff_manual','paypal'));

alter table public.club_paypal_pay_in_3_orders
  add column if not exists join_request_id uuid,
  add column if not exists entitlement_snapshot jsonb,
  add column if not exists duration_days_snapshot integer,
  add column if not exists provider_approval_url text,
  add column if not exists membership_id uuid references public.club_memberships(id) on delete restrict;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='club_paypal_order_join_request_fk') then
    alter table public.club_paypal_pay_in_3_orders add constraint club_paypal_order_join_request_fk
      foreign key(join_request_id,organisation_id)
      references public.club_membership_join_requests(id,organisation_id) on delete restrict;
  end if;
end $$;

create unique index if not exists club_paypal_one_open_order_per_join_uq
  on public.club_paypal_pay_in_3_orders(join_request_id)
  where join_request_id is not null and status in ('prepared','created','approved');
create index if not exists club_paypal_orders_user_created_idx
  on public.club_paypal_pay_in_3_orders(organisation_id,buyer_user_id,created_at desc);

create or replace function public.club_prepare_paypal_pay_in_3_order(p_join_request_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.club_membership_join_requests%rowtype;
  p public.club_products%rowtype;
  s public.club_paypal_pay_in_3_settings%rowtype;
  o public.club_organisations%rowtype;
  v_code text;
  v_order public.club_paypal_pay_in_3_orders%rowtype;
  v_snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests
    where id=p_join_request_id and user_id=auth.uid() for update;
  if not found or r.membership_id is not null or r.status in ('active','completed','cancelled') then
    raise exception 'Joining attempt is not available' using errcode='42501';
  end if;
  select * into o from public.club_organisations where id=r.organisation_id and slug='madhouse-gym' and active and member_joinable;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null for share;
  select canonical_product_code into v_code from public.club_paypal_pay_in_3_product_codes
    where organisation_id=r.organisation_id and product_id=r.product_id;
  select * into s from public.club_paypal_pay_in_3_settings where organisation_id=r.organisation_id;
  if o.id is null or p.id is null or v_code is null or v_code not in ('madhouse.transformation.bronze.v1','madhouse.transformation.silver.v1','madhouse.transformation.gold.v1','madhouse.membership.yearly.v1')
    or s.enabled is distinct from true or s.paypal_approved is distinct from true or s.accountant_approved is distinct from true
    or s.legal_entity_number<>'17383077' or nullif(btrim(s.merchant_account_id),'') is null then
    raise exception 'PayPal checkout is unavailable for this product or merchant' using errcode='22023';
  end if;
  if p.billing<>'one_off' or p.currency<>'GBP' or p.price_minor<=0 or r.upfront_amount_minor<=0
    or r.checkout_kind not in ('one_off','annual_one_off') or r.recurring_authority_state not in ('not_required','unavailable') then
    raise exception 'PayPal Pay in 3 is only available for approved one-off GBP products' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'entitlement_key',e.entitlement_key,'scope',e.scope,'location_ids',coalesce(e.location_ids,'{}'::uuid[]),
      'allowance_quantity',e.allowance_quantity,'allowance_period',e.allowance_period,
      'discount_percent',e.discount_percent,'discount_period',e.discount_period,'discount_max_uses',e.discount_max_uses
    ) order by e.entitlement_key),'[]'::jsonb)
    into v_snapshot from public.club_product_entitlements e where e.product_id=p.id;
  if jsonb_array_length(v_snapshot)=0 then raise exception 'Product entitlement definition is missing' using errcode='22023'; end if;

  select * into v_order from public.club_paypal_pay_in_3_orders
    where join_request_id=r.id and status in ('prepared','created','approved') for update;
  if found then
    if v_order.requesting_user_id<>auth.uid() or v_order.product_id<>p.id or v_order.amount_minor<>r.upfront_amount_minor
      or v_order.canonical_product_code<>v_code then raise exception 'Existing PayPal order does not match this joining attempt' using errcode='40001'; end if;
    return to_jsonb(v_order);
  end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(btrim(p_idempotency_key))<16 then
    raise exception 'A valid PayPal checkout idempotency key is required' using errcode='22023';
  end if;
  insert into public.club_paypal_pay_in_3_orders(
    organisation_id,requesting_user_id,buyer_user_id,join_request_id,product_id,canonical_product_code,
    amount_minor,currency,merchant_account_id,idempotency_key,entitlement_snapshot,duration_days_snapshot
  ) values(
    r.organisation_id,auth.uid(),auth.uid(),r.id,p.id,v_code,r.upfront_amount_minor,'GBP',s.merchant_account_id,
    btrim(p_idempotency_key),v_snapshot,p.duration_days
  ) returning * into v_order;
  update public.club_membership_join_requests set payment_method='paypal',payment_provider='paypal',upfront_provider='paypal',
    payment_state='pending',upfront_payment_state='pending',status='payment_pending',payment_failure_reason=null,
    last_activity_at=now(),updated_at=now() where id=r.id;
  return to_jsonb(v_order);
end; $$;

create or replace function public.club_store_paypal_pay_in_3_order(p_order_id uuid,p_provider_order_id text,p_approval_url text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_paypal_pay_in_3_orders%rowtype;
begin
  if auth.role()<>'service_role' or nullif(btrim(p_provider_order_id),'') is null or p_provider_order_id !~ '^[A-Za-z0-9_-]{8,80}$'
    or p_approval_url !~ '^https://(www\.paypal\.com|www\.sandbox\.paypal\.com)/' then
    raise exception 'PayPal order update is not permitted' using errcode='42501';
  end if;
  select * into o from public.club_paypal_pay_in_3_orders where id=p_order_id for update;
  if not found then raise exception 'PayPal order not found' using errcode='P0002'; end if;
  if o.status in ('captured','failed','cancelled','refunded','partially_refunded') then return to_jsonb(o); end if;
  if o.provider_order_id is not null and o.provider_order_id<>p_provider_order_id then
    raise exception 'PayPal order reference is already bound' using errcode='23505';
  end if;
  update public.club_paypal_pay_in_3_orders set provider_order_id=p_provider_order_id,
    provider_approval_url=p_approval_url,status='created' where id=o.id returning * into o;
  return to_jsonb(o);
end; $$;

create or replace function public.club_reconcile_paypal_pay_in_3_event(
  p_provider_event_id text,p_event_type text,p_provider_order_id text,p_capture_id text default null,
  p_amount_minor integer default null,p_currency text default null,p_merchant_account_id text default null,
  p_occurred_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  o public.club_paypal_pay_in_3_orders%rowtype;
  r public.club_membership_join_requests%rowtype;
  m public.club_memberships%rowtype;
  p public.club_products%rowtype;
  v_start timestamptz:=coalesce(p_occurred_at,now());
  v_end timestamptz;
  v_inserted text;
begin
  if auth.role()<>'service_role' or nullif(btrim(p_provider_event_id),'') is null or nullif(btrim(p_provider_order_id),'') is null
    or p_event_type not in ('capture_completed','capture_failed','order_cancelled') then
    raise exception 'PayPal reconciliation is not permitted' using errcode='42501';
  end if;
  insert into public.club_paypal_pay_in_3_webhook_events(provider_event_id,event_type)
    values(p_provider_event_id,p_event_type) on conflict(provider_event_id) do nothing returning provider_event_id into v_inserted;
  if v_inserted is null then return jsonb_build_object('duplicate',true); end if;
  select * into o from public.club_paypal_pay_in_3_orders where provider_order_id=p_provider_order_id for update;
  if not found then raise exception 'PayPal order is unknown' using errcode='P0002'; end if;
  if p_event_type='capture_completed' then
    if p_capture_id is null or p_capture_id='' or p_amount_minor is distinct from o.amount_minor or p_currency is distinct from o.currency
      or p_merchant_account_id is distinct from o.merchant_account_id then
      raise exception 'PayPal capture does not match its order, amount, currency, or merchant' using errcode='22023';
    end if;
    if o.status='captured' then
      if o.provider_capture_id<>p_capture_id then raise exception 'PayPal order has a different capture reference' using errcode='23505'; end if;
      return jsonb_build_object('duplicate',true,'order_id',o.id,'membership_id',o.membership_id);
    end if;
    if o.status in ('refunded','partially_refunded') then raise exception 'Refunded PayPal order cannot be captured again' using errcode='22023'; end if;
    select * into r from public.club_membership_join_requests where id=o.join_request_id and organisation_id=o.organisation_id for update;
    select * into p from public.club_products where id=o.product_id and organisation_id=o.organisation_id;
    if not found or r.user_id<>o.buyer_user_id or r.product_id<>o.product_id or r.customer_id is null then
      raise exception 'PayPal joining request no longer matches the order' using errcode='22023';
    end if;
    select * into m from public.club_memberships where organisation_id=o.organisation_id
      and assignment_idempotency_key='paypal-pay-in-3:'||o.id for update;
    if not found then
      v_end:=case when o.duration_days_snapshot is null then null else v_start+make_interval(days=>o.duration_days_snapshot) end;
      insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
        values(o.organisation_id,o.product_id,'active',v_start,v_end,'purchase','paypal-pay-in-3:'||o.id) returning * into m;
      insert into public.club_membership_holders(id,membership_id,organisation_id,user_id)
        values(gen_random_uuid(),m.id,o.organisation_id,o.buyer_user_id);
      insert into public.club_entitlement_grants(
        user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,
        discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source
      ) select o.buyer_user_id,o.organisation_id,m.id,x.entitlement_key,x.scope,coalesce(x.location_ids,'{}'::uuid[]),
        x.allowance_quantity,x.allowance_period,x.discount_percent,x.discount_period,x.discount_max_uses,m.starts_at,m.ends_at,'purchase'
        from jsonb_to_recordset(o.entitlement_snapshot) as x(
          entitlement_key text,scope text,location_ids uuid[],allowance_quantity integer,allowance_period text,
          discount_percent numeric,discount_period text,discount_max_uses integer
        );
    end if;
    update public.club_paypal_pay_in_3_orders set status='captured',provider_capture_id=p_capture_id,
      captured_at=coalesce(p_occurred_at,now()),provider_webhook_event_id=p_provider_event_id,
      entitlement_finalized_at=coalesce(entitlement_finalized_at,now()),membership_id=m.id where id=o.id returning * into o;
    insert into public.club_membership_join_provider_events(
      organisation_id,join_request_id,provider_type,provider_event_key,event_type,amount_minor,provider_reference,occurred_at
    ) values(o.organisation_id,o.join_request_id,'paypal','capture:'||p_capture_id,'upfront_confirmed',o.amount_minor,p_capture_id,coalesce(p_occurred_at,now()))
    on conflict(organisation_id,provider_type,provider_event_key) do nothing;
    update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',
      upfront_payment_state='confirmed',payment_provider='paypal',payment_provider_reference=p_capture_id,
      paid_through_at=v_end,completed_at=coalesce(completed_at,now()),last_activity_at=now(),updated_at=now()
      where id=o.join_request_id;
    update public.club_member_notification_intents set state='cancelled'
      where join_request_id=o.join_request_id and template_key='join_incomplete';
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(o.organisation_id,o.buyer_user_id,'member','payment.paypal_pay_in_3_captured','paypal_order',o.id,
        jsonb_build_object('capture_id',p_capture_id,'amount_minor',o.amount_minor,'currency',o.currency,'product_code',o.canonical_product_code))
      on conflict do nothing;
    return jsonb_build_object('duplicate',false,'order_id',o.id,'membership_id',m.id);
  end if;
  if o.status='captured' then return jsonb_build_object('duplicate',true,'order_id',o.id,'membership_id',o.membership_id); end if;
  if p_event_type='capture_failed' then
    update public.club_paypal_pay_in_3_orders set status='failed',provider_webhook_event_id=p_provider_event_id where id=o.id and status not in ('captured','refunded','partially_refunded');
    update public.club_membership_join_requests set status='payment_failed',payment_state='failed',upfront_payment_state='failed',
      payment_failure_reason='PayPal payment was not completed',updated_at=now() where id=o.join_request_id and membership_id is null;
  else
    update public.club_paypal_pay_in_3_orders set status='cancelled',provider_webhook_event_id=p_provider_event_id where id=o.id and status not in ('captured','refunded','partially_refunded');
    update public.club_membership_join_requests set status='payment_failed',payment_state='failed',upfront_payment_state='failed',
      payment_failure_reason='PayPal checkout was cancelled',updated_at=now() where id=o.join_request_id and membership_id is null;
  end if;
  return jsonb_build_object('duplicate',false,'order_id',o.id,'status',p_event_type);
end; $$;

revoke all on function public.club_prepare_paypal_pay_in_3_order(uuid,text) from public,anon;
grant execute on function public.club_prepare_paypal_pay_in_3_order(uuid,text) to authenticated;
revoke all on function public.club_store_paypal_pay_in_3_order(uuid,text,text) from public,anon,authenticated;
grant execute on function public.club_store_paypal_pay_in_3_order(uuid,text,text) to service_role;
revoke all on function public.club_reconcile_paypal_pay_in_3_event(text,text,text,text,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_reconcile_paypal_pay_in_3_event(text,text,text,text,integer,text,text,timestamptz) to service_role;

comment on function public.club_reconcile_paypal_pay_in_3_event(text,text,text,text,integer,text,text,timestamptz)
  is 'Service-role-only reconciliation for signature-verified PayPal events or verified browser-return captures. Captures and purchase entitlements commit atomically and once.';
-- END 2027-01-13-paypal-pay-in-3-checkout.sql

do $record$ declare recorded text; begin
  select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql';
  if recorded is not null and recorded<>'f41a0e196ff265176dd8aaa7a0ead071de8dc0534b7ac1dca339c39c6e516598' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql'; end if;
  insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql','f41a0e196ff265176dd8aaa7a0ead071de8dc0534b7ac1dca339c39c6e516598','manual-release-bundle','R12 launch follow-up release') on conflict (migration_name) do nothing;
end $record$;

commit;

-- Post-deployment verification (counts only; no member data is returned).
select object_name, to_regclass('public.' || object_name) is not null as present
from (values
  ('club_madhouse_staff_assignments'), ('club_madhouse_class_templates'), ('club_madhouse_rota_templates'),
  ('club_class_sessions'), ('club_class_bookings'), ('club_class_payment_events'), ('club_class_cash_collections'),
  ('club_stripe_membership_events'), ('club_stripe_commerce_events'),
  ('club_paypal_pay_in_3_settings'), ('club_paypal_pay_in_3_product_codes'),
  ('club_paypal_pay_in_3_orders'), ('club_paypal_pay_in_3_webhook_events'), ('r12_schema_migrations')
) as required(object_name) order by object_name;

select
  (select count(*) from public.club_madhouse_staff_assignments) as prepared_staff_assignments,
  (select count(*) from public.club_madhouse_class_templates) as class_templates,
  (select count(*) from public.club_class_sessions) as dated_class_sessions,
  (select count(*) from public.club_class_bookings) as class_bookings,
  (select count(*) from public.club_class_payment_events) as class_payment_events,
  (select count(*) from public.club_class_cash_collections) as class_cash_collections,
  (select count(*) from public.club_stripe_membership_events) as stripe_membership_events,
  (select count(*) from public.club_stripe_commerce_events) as stripe_commerce_events,
  (select count(*) from public.club_paypal_pay_in_3_orders) as paypal_orders;

select migration_name, checksum, applied_at, source
from public.r12_schema_migrations
where migration_name in ('supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql','supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql','supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql','supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql')
order by migration_name;

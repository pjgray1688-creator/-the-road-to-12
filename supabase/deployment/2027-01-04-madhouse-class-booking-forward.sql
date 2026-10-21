-- Madhouse class booking forward release.
-- Apply only after the November 2026 final-state baseline and the target
-- Madhouse organisation have been verified. Keep these timestamped migration
-- files in the manifest unchanged. This is a single-paste equivalent of the
-- ordered forward chain and records each source file checksum for the runner.
-- Do not apply this bundle and the same pending migration files separately.
begin;

-- BEGIN 2027-01-04-madhouse-class-booking-fail-closed.sql
-- Fail closed until class pricing, verified payment, and package-authorised
-- included class credits are implemented together in one transactional flow.
-- Existing direct authenticated callers of the legacy booking RPC cannot
-- create a free confirmed booking after this migration is applied.
create or replace function public.club_create_class_booking(
  p_session_id uuid, p_customer_id uuid, p_status text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  raise exception 'Class booking is unavailable until verified payment and package entitlements are configured'
    using errcode='55000';
end; $$;

revoke all on function public.club_create_class_booking(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.club_create_class_booking(uuid,uuid,text) to authenticated;
-- END 2027-01-04-madhouse-class-booking-fail-closed.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql';
if recorded is not null and recorded<>'3ecd2a330e4ccdb3a3db16e3f68fa4869dd95de16b7ecdba8cc7c73271df09a7' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql','3ecd2a330e4ccdb3a3db16e3f68fa4869dd95de16b7ecdba8cc7c73271df09a7','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

-- BEGIN 2027-01-05-madhouse-weekly-operations-import.sql
-- Authoritative Madhouse weekly operating templates. This is preparation data,
-- not dated class instances or rota shifts. All wall-clock times use
-- Europe/London; consumers must resolve DST for each actual date.

create table if not exists public.club_madhouse_class_templates (
  organisation_id uuid not null,
  template_key text not null,
  weekday smallint not null check (weekday between 1 and 7),
  starts_local time not null,
  class_name text not null,
  location_name text not null,
  instructor_name text not null,
  capacity integer not null default 6 check (capacity = 6),
  transformation_credit_limit integer not null default 2 check (transformation_credit_limit = 2),
  duration_minutes integer,
  effective_from date,
  time_zone text not null default 'Europe/London' check (time_zone = 'Europe/London'),
  active boolean not null default true,
  primary key (organisation_id, template_key),
  check (duration_minutes is null or duration_minutes > 0)
);
alter table public.club_madhouse_class_templates enable row level security;
revoke all on public.club_madhouse_class_templates from public,anon,authenticated;

insert into public.club_madhouse_class_templates
  (organisation_id,template_key,weekday,starts_local,class_name,location_name,instructor_name,capacity,transformation_credit_limit)
values
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','monday-boxing-rotherham',1,'18:00','Boxing','Rotherham','Luke',6,2),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','tuesday-women-only-carlton',2,'19:00','Women Only','Carlton','Amie',6,2),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','wednesday-hiit-carlton',3,'18:00','HIIT','Carlton','Keenan',6,2),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','wednesday-circuit-rotherham',3,'18:00','Circuit','Rotherham','Luke',6,2),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','thursday-women-only-rotherham',4,'10:00','Women Only','Rotherham','Amie',6,2),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','friday-circuit-carlton',5,'10:00','Circuit','Carlton','Keenan',6,2)
on conflict (organisation_id,template_key) do update set
 weekday=excluded.weekday,starts_local=excluded.starts_local,class_name=excluded.class_name,
 location_name=excluded.location_name,instructor_name=excluded.instructor_name,
 capacity=excluded.capacity,transformation_credit_limit=excluded.transformation_credit_limit,
 time_zone='Europe/London',active=true;

create table if not exists public.club_madhouse_rota_templates (
  organisation_id uuid not null,
  template_key text not null,
  weekday smallint not null check (weekday between 1 and 7),
  starts_local time not null,
  ends_local time not null check (ends_local > starts_local),
  location_name text not null,
  staff_name text not null,
  time_zone text not null default 'Europe/London' check (time_zone = 'Europe/London'),
  effective_from date,
  active boolean not null default true,
  primary key (organisation_id,template_key)
);
alter table public.club_madhouse_rota_templates enable row level security;
revoke all on public.club_madhouse_rota_templates from public,anon,authenticated;
insert into public.club_madhouse_rota_templates
  (organisation_id,template_key,weekday,starts_local,ends_local,location_name,staff_name)
values
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','monday-carlton-steve',1,'14:00','20:00','Carlton','Steve'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','tuesday-carlton-amie',2,'14:00','20:00','Carlton','Amie'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','wednesday-carlton-keenan',3,'14:00','20:00','Carlton','Keenan'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','thursday-carlton-keenan',4,'09:00','14:00','Carlton','Keenan'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','thursday-carlton-shannon',4,'14:00','20:00','Carlton','Shannon'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','friday-carlton-shannon',5,'09:00','20:00','Carlton','Shannon'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','saturday-carlton-cody',6,'10:00','13:00','Carlton','Cody'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','monday-rotherham-amie',1,'09:00','14:00','Rotherham','Amie'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','monday-rotherham-luke',1,'14:00','19:00','Rotherham','Luke'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','tuesday-rotherham-keenan',2,'12:00','18:00','Rotherham','Keenan'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','wednesday-rotherham-luke',3,'14:00','19:00','Rotherham','Luke'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','thursday-rotherham-amie',4,'09:00','14:00','Rotherham','Amie'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','thursday-rotherham-keenan',4,'14:00','19:00','Rotherham','Keenan'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','friday-rotherham-keenan',5,'08:00','20:00','Rotherham','Keenan')
on conflict (organisation_id,template_key) do update set
 weekday=excluded.weekday,starts_local=excluded.starts_local,ends_local=excluded.ends_local,
 location_name=excluded.location_name,staff_name=excluded.staff_name,time_zone='Europe/London',active=true;

create table if not exists public.club_location_service_hours (
  organisation_id uuid not null,
  location_name text not null,
  service_key text not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens_local time,
  closes_local time,
  confirmation_state text not null check (confirmation_state in ('confirmed','confirmed_closed','unconfirmed')),
  time_zone text not null default 'Europe/London' check (time_zone = 'Europe/London'),
  source_note text not null,
  primary key (organisation_id,location_name,service_key,weekday),
  check ((confirmation_state in ('unconfirmed','confirmed_closed') and opens_local is null and closes_local is null)
      or (confirmation_state='confirmed' and opens_local is not null and closes_local is not null and closes_local>opens_local))
);
-- Reconcile earlier prepared versions of this import that represented Sunday
-- as unconfirmed. Hours are a single shared sunbed-service source.
alter table public.club_location_service_hours drop constraint if exists club_location_service_hours_state_ck;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.club_location_service_hours'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%confirmation_state%' loop
    execute format('alter table public.club_location_service_hours drop constraint %I',c.conname);
  end loop;
  alter table public.club_location_service_hours add constraint club_location_service_hours_state_ck
    check ((confirmation_state in ('unconfirmed','confirmed_closed') and opens_local is null and closes_local is null)
      or (confirmation_state='confirmed' and opens_local is not null and closes_local is not null and closes_local>opens_local));
end $$;
alter table public.club_location_service_hours enable row level security;
revoke all on public.club_location_service_hours from public,anon,authenticated;
grant select on public.club_location_service_hours to authenticated;
grant select on public.club_location_service_hours to anon;
drop policy if exists club_location_service_hours_read on public.club_location_service_hours;
create policy club_location_service_hours_read on public.club_location_service_hours
  for select to anon,authenticated using (service_key='sunbeds');
insert into public.club_location_service_hours
  (organisation_id,location_name,service_key,weekday,opens_local,closes_local,confirmation_state,source_note)
values
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',1,'14:00','20:00','confirmed','Owner-confirmed staffed Carlton hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',2,'14:00','20:00','confirmed','Owner-confirmed staffed Carlton hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',3,'14:00','20:00','confirmed','Owner-confirmed staffed Carlton hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',4,'09:00','20:00','confirmed','Owner-confirmed staffed Carlton hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',5,'09:00','20:00','confirmed','Owner-confirmed staffed Carlton hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',6,'10:00','13:00','confirmed','Owner-confirmed Glow Zone hours; sunbed service only'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Carlton','sunbeds',7,null,null,'confirmed_closed','Owner-confirmed Sunday closure; sunbed service only')
on conflict (organisation_id,location_name,service_key,weekday) do update set
 opens_local=excluded.opens_local,closes_local=excluded.closes_local,
 confirmation_state=excluded.confirmation_state,time_zone='Europe/London',source_note=excluded.source_note;

create table if not exists public.club_madhouse_class_commercial_config (
  organisation_id uuid primary key,
  payg_price_minor integer not null check (payg_price_minor=1000),
  currency text not null check (currency='GBP'),
  monthly_addon_price_minor integer not null check (monthly_addon_price_minor=2500),
  monthly_addon_active boolean not null default false check (monthly_addon_active=false),
  source_note text not null
);
alter table public.club_madhouse_class_commercial_config enable row level security;
revoke all on public.club_madhouse_class_commercial_config from public;
grant select on public.club_madhouse_class_commercial_config to authenticated;
drop policy if exists club_madhouse_class_commercial_config_read on public.club_madhouse_class_commercial_config;
create policy club_madhouse_class_commercial_config_read on public.club_madhouse_class_commercial_config for select to authenticated using (public.club_has_customer_access(organisation_id));
insert into public.club_madhouse_class_commercial_config
  (organisation_id,payg_price_minor,currency,monthly_addon_price_minor,monthly_addon_active,source_note)
values ('fa44592a-1593-4ad3-a621-63a4a4bcbceb',1000,'GBP',2500,false,'Confirmed £10 GBP PAYG. Proposed £25/month add-on remains inactive and unavailable for sale.')
on conflict (organisation_id) do update set payg_price_minor=1000,currency='GBP',monthly_addon_price_minor=2500,monthly_addon_active=false,source_note=excluded.source_note;

-- Match package definitions to the confirmed commercial rule. Existing active
-- transformation holders receive the one weekly credit; existing bookings and
-- usage rows are untouched. Membership product definitions no longer promise
-- class_access. The booking RPC still requires a future policy for the weekly
-- period key before it can consume any of these credits.
delete from public.club_product_entitlements e using public.club_products p
where p.id=e.product_id and p.organisation_id=e.organisation_id
  and p.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
  and p.kind='membership' and e.entitlement_key='class_access';

insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids,allowance_quantity,allowance_period)
select p.id,p.organisation_id,coalesce(max(e.position)+1,0),'included_class_credit','organisation','{}',1,'week'
from public.club_products p left join public.club_product_entitlements e on e.product_id=p.id
where p.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and p.kind='transformation'
  and not exists(select 1 from public.club_product_entitlements old where old.product_id=p.id and old.entitlement_key='included_class_credit')
group by p.id,p.organisation_id;

insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,starts_at,ends_at,source)
select h.user_id,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,m.starts_at,m.ends_at,m.source
from public.club_memberships m join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
join public.club_membership_holders h on h.membership_id=m.id
join public.club_product_entitlements e on e.product_id=p.id and e.organisation_id=p.organisation_id and e.entitlement_key='included_class_credit'
where m.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and p.kind='transformation'
  and h.user_id is not null and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
  and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=h.user_id and g.entitlement_key=e.entitlement_key);

-- Capacity checks serialize on the session row. The legacy booking RPC remains
-- fail-closed until provider-verified PAYG and entitlement consumption are
-- delivered; this trigger is defense in depth for any future write path.
alter table public.club_class_sessions
  add column if not exists max_transformation_credit_bookings integer not null default 2;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_class_sessions'::regclass and conname='club_class_transform_cap_chk') then
    alter table public.club_class_sessions add constraint club_class_transform_cap_chk check (max_transformation_credit_bookings between 0 and 2);
  end if;
end $$;
alter table public.club_class_bookings
  add column if not exists funding_type text not null default 'legacy_unknown';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_class_bookings'::regclass and conname='club_class_booking_funding_type_chk') then
    alter table public.club_class_bookings add constraint club_class_booking_funding_type_chk check (funding_type in ('legacy_unknown','payg','transformation_credit','class_credit'));
  end if;
end $$;

create or replace function public.club_enforce_madhouse_class_capacity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_class_sessions%rowtype; total_count integer; transformation_count integer; madhouse boolean;
begin
  if new.status not in ('confirmed','waitlisted') then return new; end if;
  select lower(name)='madhouse gym' into madhouse from public.club_organisations where id=new.organisation_id;
  if not coalesce(madhouse,false) then return new; end if;
  select * into s from public.club_class_sessions where id=new.session_id and organisation_id=new.organisation_id for update;
  if not found then raise exception 'Class session unavailable' using errcode='P0002'; end if;
  if s.capacity is not null and s.capacity>6 then raise exception 'Madhouse class capacity cannot exceed six' using errcode='22023'; end if;
  if new.status='confirmed' then
    select count(*) into total_count from public.club_class_bookings b where b.session_id=s.id and b.status='confirmed' and b.id<>new.id;
    if total_count>=least(coalesce(s.capacity,6),6) then raise exception 'Class capacity reached' using errcode='22023'; end if;
    select count(*) into transformation_count from public.club_class_bookings b where b.session_id=s.id and b.status='confirmed' and b.id<>new.id and (b.funding_type='transformation_credit' or b.entitlement_usage_id is not null);
    if (new.funding_type='transformation_credit' or new.entitlement_usage_id is not null) and transformation_count>=least(s.max_transformation_credit_bookings,2) then
      raise exception 'Transformation included-class capacity reached' using errcode='22023';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_class_capacity on public.club_class_bookings;
create trigger club_madhouse_class_capacity before insert or update of session_id,status,funding_type,entitlement_usage_id on public.club_class_bookings
  for each row execute function public.club_enforce_madhouse_class_capacity();

create or replace function public.club_enforce_madhouse_session_limit()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare madhouse boolean;
begin
  select lower(name)='madhouse gym' into madhouse from public.club_organisations where id=new.organisation_id;
  if coalesce(madhouse,false) then
    if new.capacity is null then new.capacity:=6; end if;
    if new.capacity>6 then raise exception 'Madhouse classes have a maximum capacity of six' using errcode='22023'; end if;
    if new.max_transformation_credit_bookings>2 then raise exception 'Madhouse classes allow at most two included transformation bookings' using errcode='22023'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_class_session_limit on public.club_class_sessions;
create trigger club_madhouse_class_session_limit before insert or update of organisation_id,capacity,max_transformation_credit_bookings on public.club_class_sessions
  for each row execute function public.club_enforce_madhouse_session_limit();

create table if not exists public.club_class_booking_cancellations (
  booking_id uuid primary key references public.club_class_bookings(id) on delete restrict,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  funding_type text not null,
  customer_id uuid,
  session_id uuid,
  location_id uuid,
  original_booked_at timestamptz,
  class_starts_at timestamptz,
  late_cancellation boolean not null default false,
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  class_credit_entry_id uuid references public.club_service_credit_entries(id) on delete set null,
  entitlement_usage_restored_id uuid,
  cancelled_at timestamptz not null default now(),
  management_note text
);
alter table public.club_class_booking_cancellations add column if not exists customer_id uuid;
alter table public.club_class_booking_cancellations add column if not exists session_id uuid;
alter table public.club_class_booking_cancellations add column if not exists location_id uuid;
alter table public.club_class_booking_cancellations add column if not exists original_booked_at timestamptz;
alter table public.club_class_booking_cancellations add column if not exists class_starts_at timestamptz;
alter table public.club_class_booking_cancellations add column if not exists late_cancellation boolean not null default false;
alter table public.club_class_booking_cancellations add column if not exists reason text;
alter table public.club_class_booking_cancellations enable row level security;
revoke all on public.club_class_booking_cancellations from public,anon,authenticated;
create index if not exists club_class_booking_cancellations_org_date_idx on public.club_class_booking_cancellations(organisation_id,cancelled_at desc);
insert into public.club_class_booking_cancellations(booking_id,organisation_id,funding_type,actor_user_id,management_note,cancelled_at)
select b.id,b.organisation_id,b.funding_type,null,'Legacy cancellation imported; funding source not inferred',coalesce(b.cancelled_at,b.updated_at)
from public.club_class_bookings b where b.status='cancelled'
on conflict (booking_id) do nothing;

create or replace function public.club_cancel_class_booking(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_class_bookings%rowtype; c public.club_customers%rowtype; s public.club_class_sessions%rowtype;
  staff boolean; restored_usage uuid; credit_account uuid; credit_entry uuid; balance integer;
begin
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into c from public.club_customers where id=b.customer_id;
  select * into s from public.club_class_sessions where id=b.session_id for update;
  staff:=public.club_has_active_role(b.organisation_id,array['gym_staff','gym_admin','owner']) or s.host_user_id=auth.uid();
  if auth.uid() is null or (c.user_id is distinct from auth.uid() and not staff) then raise exception 'Booking cancellation is not permitted' using errcode='42501'; end if;
  if b.status='cancelled' then return to_jsonb(b); end if;
  if not staff and s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at then raise exception 'Cancellation window is closed' using errcode='22023'; end if;
  if b.funding_type='legacy_unknown' then
    -- Preserve legacy records; never guess how an old booking was funded.
    insert into public.club_class_booking_cancellations(booking_id,organisation_id,funding_type,customer_id,session_id,location_id,original_booked_at,class_starts_at,late_cancellation,actor_user_id,management_note)
      values(b.id,b.organisation_id,b.funding_type,b.customer_id,b.session_id,s.location_id,b.booked_at,s.starts_at,s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at,auth.uid(),'Legacy funding source unresolved; no automatic credit inferred');
  elsif b.funding_type='transformation_credit' then
    if b.entitlement_usage_id is null then raise exception 'Transformation booking has no linked allowance use' using errcode='55000'; end if;
    delete from public.club_entitlement_usage where id=b.entitlement_usage_id returning id into restored_usage;
    if restored_usage is null then raise exception 'Included class allowance could not be restored' using errcode='55000'; end if;
    insert into public.club_class_booking_cancellations(booking_id,organisation_id,funding_type,customer_id,session_id,location_id,original_booked_at,class_starts_at,late_cancellation,actor_user_id,entitlement_usage_restored_id)
      values(b.id,b.organisation_id,b.funding_type,b.customer_id,b.session_id,s.location_id,b.booked_at,s.starts_at,s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at,auth.uid(),restored_usage);
  elsif b.funding_type in ('payg','class_credit') then
    if c.user_id is null then raise exception 'Class credit owner is unresolved' using errcode='55000'; end if;
    insert into public.club_service_credit_accounts(organisation_id,user_id,credit_key,unit,status)
      values(b.organisation_id,c.user_id,'class_sessions','class','active')
      on conflict(organisation_id,credit_key,user_id) do update set updated_at=now()
      returning id into credit_account;
    select coalesce(sum(e.quantity_delta),0)+1 into balance from public.club_service_credit_entries e where e.account_id=credit_account;
    insert into public.club_service_credit_entries(account_id,organisation_id,entry_type,quantity_delta,balance_after,actor_user_id,idempotency_key,occurred_at)
      values(credit_account,b.organisation_id,'refund_restoration',1,balance,auth.uid(),'class-cancel:'||b.id::text,now()) returning id into credit_entry;
    insert into public.club_class_booking_cancellations(booking_id,organisation_id,funding_type,customer_id,session_id,location_id,original_booked_at,class_starts_at,late_cancellation,actor_user_id,class_credit_entry_id)
      values(b.id,b.organisation_id,b.funding_type,b.customer_id,b.session_id,s.location_id,b.booked_at,s.starts_at,s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at,auth.uid(),credit_entry);
  else
    raise exception 'Unsupported class booking funding source' using errcode='55000';
  end if;
  update public.club_class_bookings set status='cancelled',cancelled_at=now(),updated_at=now() where id=b.id returning * into b;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_cancel_class_booking(uuid) from public;
grant execute on function public.club_cancel_class_booking(uuid) to authenticated;

create or replace function public.club_list_class_booking_cancellations(p_organisation_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Class cancellation report is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '93 days' then raise exception 'Invalid cancellation report window' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bookingId',x.booking_id,'memberId',x.customer_id,'classSessionId',x.session_id,'locationId',x.location_id,'originalBookingDate',x.original_booked_at,'classStartsAt',x.class_starts_at,'fundingType',x.funding_type,'creditIssued',x.class_credit_entry_id is not null,'entitlementRestored',x.entitlement_usage_restored_id is not null,'lateCancellation',x.late_cancellation,'actorUserId',x.actor_user_id,'cancelledAt',x.cancelled_at,'reason',x.reason,'managementNote',x.management_note) order by x.cancelled_at desc)
    from public.club_class_booking_cancellations x where x.organisation_id=p_organisation_id and x.cancelled_at>=p_from and x.cancelled_at<p_to),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) to authenticated;
-- END 2027-01-05-madhouse-weekly-operations-import.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql';
if recorded is not null and recorded<>'d2b7323eb157bae8906a39b9dc26c3ff41ad3dad6e129d38c65be5056b49ab6c' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql','d2b7323eb157bae8906a39b9dc26c3ff41ad3dad6e129d38c65be5056b49ab6c','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

-- BEGIN 2027-01-06-madhouse-trusted-station-checkin.sql
-- A scan's venue is resolved only from an authenticated registered station.
-- The existing kiosk/station cookie protocol is unchanged.
create or replace function public.club_shared_station_identity(p_station_id uuid,p_station_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare s public.club_shared_stations%rowtype; l public.club_locations%rowtype;
begin
  if auth.uid() is null or p_station_token is null then raise exception 'Station authentication required' using errcode='42501'; end if;
  select * into s from public.club_shared_stations x where x.id=p_station_id and x.enabled and x.token_hash=extensions.digest(convert_to(p_station_token,'UTF8'),'sha256');
  if not found or not public.club_capability_allowed(s.organisation_id,auth.uid(),'members.view') then raise exception 'Station is not trusted' using errcode='42501'; end if;
  select * into l from public.club_locations where id=s.location_id and organisation_id=s.organisation_id and active;
  if not found then raise exception 'Station location is unavailable' using errcode='55000'; end if;
  return jsonb_build_object('organisationId',s.organisation_id,'locationId',l.id,'locationName',l.name,'stationName',s.station_name);
end; $$;

create or replace function public.club_checkin_station_scan(p_station_id uuid,p_station_token text,p_credential text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare s public.club_shared_stations%rowtype; result jsonb; decision_id uuid; visit public.club_attendance_visits%rowtype; display_name text; is_new boolean:=false;
begin
  if auth.uid() is null or p_station_token is null or nullif(btrim(p_credential),'') is null then raise exception 'Station authentication and member QR are required' using errcode='42501'; end if;
  select * into s from public.club_shared_stations x where x.id=p_station_id and x.enabled and x.token_hash=extensions.digest(convert_to(p_station_token,'UTF8'),'sha256');
  if not found or not public.club_capability_allowed(s.organisation_id,auth.uid(),'members.view') then raise exception 'Station is not trusted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=s.location_id and organisation_id=s.organisation_id and active) then raise exception 'Station location is unavailable' using errcode='55000'; end if;
  result:=public.club_reception_access_decision(s.organisation_id,s.location_id,p_credential,'qr');
  decision_id:=nullif(result->>'auditReference','')::uuid;
  if decision_id is not null then
    update public.club_access_decisions set station_label=left(s.station_name,80) where id=decision_id and organisation_id=s.organisation_id;
    update public.club_attendance_visits set station_label=left(s.station_name,80) where access_decision_id=decision_id and organisation_id=s.organisation_id;
    select * into visit from public.club_attendance_visits where access_decision_id=decision_id and organisation_id=s.organisation_id;
    is_new:=found;
    if not is_new then select v.* into visit from public.club_access_decisions d join public.club_attendance_visits v on v.access_decision_id=d.bounce_of where d.id=decision_id and d.organisation_id=s.organisation_id; end if;
  end if;
  display_name:=nullif(btrim(result->'member'->>'displayName'),'');
  return jsonb_build_object('allowed',coalesce((result->>'allowed')::boolean,false),'decision',result->>'decision','reason',result->>'reason',
    'member',case when display_name is null then null else jsonb_build_object('displayName',split_part(display_name,' ',1)) end,
    'attendanceRecorded',is_new,'repeatVisit',coalesce((result->>'allowed')::boolean,false) and not is_new,
    'checkedAt',visit.checked_at,'stationLabel',s.station_name,'locationId',s.location_id);
end; $$;

-- Retire the old caller-selected location API. Do not leave an alternate path.
create or replace function public.club_checkin_station_scan(p_organisation_id uuid,p_location_id uuid,p_credential text,p_station_label text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin raise exception 'Registered station authentication is required' using errcode='42501'; end; $$;
revoke all on function public.club_shared_station_identity(uuid,text),public.club_checkin_station_scan(uuid,text,text),public.club_checkin_station_scan(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.club_shared_station_identity(uuid,text),public.club_checkin_station_scan(uuid,text,text) to authenticated;
-- END 2027-01-06-madhouse-trusted-station-checkin.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql';
if recorded is not null and recorded<>'611d789195b14188097d516590b0428a37cafacb26cbcc281ecc2b12e40bcf0d' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql','611d789195b14188097d516590b0428a37cafacb26cbcc281ecc2b12e40bcf0d','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

-- BEGIN 2027-01-07-madhouse-class-credit-iso-weeks.sql
-- Included classes are consumed against the ISO week in which the session
-- occurs. Paid class cancellation creates an expiring, reusable class credit.
alter table public.club_class_bookings add column if not exists class_credit_id uuid;
alter table public.club_class_bookings add column if not exists payment_method text;
alter table public.club_class_bookings add column if not exists payment_status text not null default 'not_required';
alter table public.club_class_bookings add column if not exists payment_amount_minor integer;
alter table public.club_class_bookings add column if not exists payment_currency text;
alter table public.club_class_bookings add column if not exists stripe_checkout_session_id text;
alter table public.club_class_bookings add column if not exists stripe_payment_intent_id text;

create table if not exists public.club_class_weekly_entitlement_state (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, entitlement_type text not null check(entitlement_type='included_class_credit'),
  iso_week_year integer not null, iso_week_number integer not null check(iso_week_number between 1 and 53),
  grant_id uuid not null references public.club_entitlement_grants(id) on delete restrict,
  session_id uuid not null references public.club_class_sessions(id) on delete restrict,
  booking_id uuid references public.club_class_bookings(id) on delete restrict,
  usage_status text not null check(usage_status in ('used','restored')),
  used_at timestamptz not null default now(), restored_at timestamptz,
  unique(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number),
  check((usage_status='used' and booking_id is not null and restored_at is null) or usage_status='restored')
);
create table if not exists public.club_class_weekly_entitlement_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, entitlement_type text not null,
  iso_week_year integer not null, iso_week_number integer not null, session_id uuid not null references public.club_class_sessions(id) on delete restrict,
  booking_id uuid not null references public.club_class_bookings(id) on delete restrict,
  event_type text not null check(event_type in ('used','restored')), actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(), idempotency_key text not null,
  unique(organisation_id,idempotency_key)
);
alter table public.club_class_weekly_entitlement_state enable row level security;
alter table public.club_class_weekly_entitlement_events enable row level security;
revoke all on public.club_class_weekly_entitlement_state,public.club_class_weekly_entitlement_events from public,anon,authenticated;

create table if not exists public.club_reusable_class_credits (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  customer_id uuid not null references public.club_customers(id) on delete restrict,
  original_booking_id uuid not null references public.club_class_bookings(id) on delete restrict,
  cancellation_booking_id uuid not null unique references public.club_class_bookings(id) on delete restrict,
  original_funding_method text not null check(original_funding_method in ('payg','class_credit')),
  original_source_reference text, session_id uuid not null references public.club_class_sessions(id) on delete restrict,
  location_id uuid not null references public.club_locations(id) on delete restrict,
  issuing_actor_type text not null check(issuing_actor_type in ('member_cancellation','madhouse_cancellation')),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(), expires_at timestamptz not null,
  redeemed_at timestamptz, redeemed_booking_id uuid references public.club_class_bookings(id) on delete restrict,
  check(expires_at>issued_at), check((redeemed_at is null)=(redeemed_booking_id is null))
);
create index if not exists club_reusable_class_credits_member_expiry_idx on public.club_reusable_class_credits(customer_id,expires_at) where redeemed_at is null;
create table if not exists public.club_reusable_class_credit_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  credit_id uuid not null references public.club_reusable_class_credits(id) on delete restrict,
  customer_id uuid not null references public.club_customers(id) on delete restrict,
  event_type text not null check(event_type in ('issued','redeemed')),
  source_booking_id uuid not null references public.club_class_bookings(id) on delete restrict,
  related_booking_id uuid references public.club_class_bookings(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(), idempotency_key text not null,
  unique(organisation_id,idempotency_key)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.club_class_bookings'::regclass and conname='club_class_booking_credit_fk') then
    alter table public.club_class_bookings add constraint club_class_booking_credit_fk foreign key(class_credit_id) references public.club_reusable_class_credits(id) on delete restrict;
  end if;
end $$;
alter table public.club_class_booking_cancellations add column if not exists reusable_credit_id uuid references public.club_reusable_class_credits(id) on delete set null;
alter table public.club_reusable_class_credits enable row level security;
alter table public.club_reusable_class_credit_events enable row level security;
revoke all on public.club_reusable_class_credits,public.club_reusable_class_credit_events from public,anon,authenticated;

-- Materialise the full weekly template into the existing rota only when an
-- authorised manager supplies a future date window. Existing shifts are never
-- edited; ambiguous staff/location identity or overlaps fail/skip safely.
alter table public.club_staff_rota_shifts add column if not exists source_template_key text;
create unique index if not exists club_staff_rota_generated_template_day_uq
  on public.club_staff_rota_shifts(organisation_id,source_template_key,work_date) where source_template_key is not null;
alter table public.club_class_sessions add column if not exists source_template_key text;
alter table public.club_class_sessions add column if not exists source_template_date date;
create unique index if not exists club_madhouse_class_generated_template_day_uq
  on public.club_class_sessions(organisation_id,source_template_key,source_template_date) where source_template_key is not null;

create or replace function public.club_madhouse_generate_class_sessions(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_class_templates%rowtype; work_day date; staff_id uuid; loc_id uuid; matches integer; class_type uuid;
  created_count integer:=0; existing_count integer:=0; conflict_count integer:=0; starts timestamptz; new_session public.club_class_sessions%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Class schedule management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<greatest((now() at time zone 'Europe/London')::date,date '2026-10-19') or p_to<p_from or p_to-p_from>366 then raise exception 'Choose future class dates in the confirmed timetable window' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_class_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    class_type:=null;
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-class:'||t.template_key,0));
    select count(*),min(m.user_id::text)::uuid into matches,staff_id from public.club_members m join public.profiles p on p.id=m.user_id
      where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner')
      and (case when t.instructor_name='Amie' then lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g')) in ('amie','aim','aims','amis')
        when t.instructor_name='Shannon' then lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g')) in ('shannon','shan','sahn')
        else lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=lower(regexp_replace(t.instructor_name,'[^a-z]','','g')) end);
    if matches<>1 then raise exception 'Instructor identity for class template % must resolve to exactly one active Madhouse account',t.template_key using errcode='55000'; end if;
    select count(*),min(l.id::text)::uuid into matches,loc_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name);
    if matches<>1 then raise exception 'Location identity for class template % must resolve to exactly one active Madhouse location',t.template_key using errcode='55000'; end if;
    insert into public.club_class_types(organisation_id,name,description,default_duration_minutes,default_capacity)
      values(p_organisation_id,t.class_name,'Scheduling window up to 60 minutes; actual class duration is not confirmed.',60,6)
      on conflict(organisation_id,name) do nothing returning id into class_type;
    if class_type is null then select id into class_type from public.club_class_types where organisation_id=p_organisation_id and name=t.class_name; end if;
    if not exists(select 1 from public.club_class_types where id=class_type and active) then raise exception 'Class type % must resolve to one active type',t.class_name using errcode='55000'; end if;
    for work_day in select d::date from generate_series(p_from,p_to,interval '1 day') d where extract(isodow from d)=t.weekday loop
      if exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.source_template_key=t.template_key and s.source_template_date=work_day) then existing_count:=existing_count+1; continue; end if;
      starts:=(work_day+t.starts_local) at time zone 'Europe/London';
      if starts<=now() then continue; end if;
      if exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.host_user_id=staff_id and s.status='scheduled' and s.starts_at<starts+interval '60 minutes' and s.ends_at>starts) then conflict_count:=conflict_count+1; continue; end if;
      insert into public.club_class_sessions(organisation_id,location_id,class_type_id,host_user_id,title,starts_at,ends_at,capacity,max_transformation_credit_bookings,visibility,status,source_template_key,source_template_date)
        values(p_organisation_id,loc_id,class_type,staff_id,t.class_name,starts,starts+interval '60 minutes',6,2,'public','scheduled',t.template_key,work_day)
        on conflict(organisation_id,source_template_key,source_template_date) where source_template_key is not null do nothing returning * into new_session;
      if not found then existing_count:=existing_count+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,auth.uid(),actor_role,'schedule.class.generated','class_session',new_session.id,jsonb_build_object('template_key',t.template_key,'work_date',work_day,'location_id',loc_id,'host_user_id',staff_id));
      created_count:=created_count+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_count,'alreadyGenerated',existing_count,'skippedConflicts',conflict_count,'from',p_from,'to',p_to,'timeZone','Europe/London');
end; $$;
revoke all on function public.club_madhouse_generate_class_sessions(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_class_sessions(uuid,date,date) to authenticated;

create or replace function public.club_madhouse_generate_rota(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_rota_templates%rowtype; work_day date; staff_id uuid; loc_id uuid; matches integer; actor_role text;
  created_count integer:=0; existing_count integer:=0; conflict_count integer:=0; new_shift public.club_staff_rota_shifts%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<(now() at time zone 'Europe/London')::date or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a future rota window of up to one year' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_rota_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-rota:'||t.template_key,0));
    select count(*),min(m.user_id::text)::uuid into matches,staff_id
    from public.club_members m join public.profiles p on p.id=m.user_id
    where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner')
      and (case when t.staff_name='Amie' then lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g')) in ('amie','aim','aims','amis')
        when t.staff_name='Shannon' then lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g')) in ('shannon','shan','sahn')
        else lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=lower(regexp_replace(t.staff_name,'[^a-z]','','g')) end);
    if matches<>1 then raise exception 'Staff identity for rota template % must resolve to exactly one active Madhouse account',t.template_key using errcode='55000'; end if;
    select count(*),min(l.id::text)::uuid into matches,loc_id from public.club_locations l
      where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name);
    if matches<>1 then raise exception 'Location for rota template % must resolve to exactly one active Madhouse location',t.template_key using errcode='55000'; end if;
    for work_day in select d::date from generate_series(p_from,p_to,interval '1 day') d where extract(isodow from d)=t.weekday loop
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.source_template_key=t.template_key and r.work_date=work_day and r.status='scheduled') then
        existing_count:=existing_count+1; continue;
      end if;
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.staff_user_id=staff_id and r.work_date=work_day and r.status='scheduled' and r.starts_at<t.ends_local and r.ends_at>t.starts_local) then
        conflict_count:=conflict_count+1; continue;
      end if;
      insert into public.club_staff_rota_shifts(organisation_id,staff_user_id,work_date,starts_at,ends_at,location_id,note,created_by,updated_by,source_template_key)
        values(p_organisation_id,staff_id,work_day,t.starts_local,t.ends_local,loc_id,'Generated from approved Madhouse weekly rota template',auth.uid(),auth.uid(),t.template_key)
        on conflict(organisation_id,source_template_key,work_date) where source_template_key is not null do nothing returning * into new_shift;
      if not found then existing_count:=existing_count+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,auth.uid(),actor_role,'schedule.rota.created','rota_shift',new_shift.id,jsonb_build_object('staff_user_id',staff_id,'work_date',work_day,'starts_at',t.starts_local,'ends_at',t.ends_local,'location_id',loc_id,'template_key',t.template_key));
      created_count:=created_count+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_count,'alreadyGenerated',existing_count,'skippedConflicts',conflict_count,'from',p_from,'to',p_to);
end; $$;
revoke all on function public.club_madhouse_generate_rota(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_rota(uuid,date,date) to authenticated;

create or replace function public.club_redeem_transformation_class_credit(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; c public.club_customers%rowtype; g public.club_entitlement_grants%rowtype;
  local_date date; week_year integer; week_number integer; week_key text; usage_id uuid; state_id uuid; booking public.club_class_bookings%rowtype; existing public.club_class_bookings%rowtype;
begin
  select * into s from public.club_class_sessions where id=p_session_id for update;
  if not found or s.status<>'scheduled' or s.starts_at<=now() or s.capacity>6 then raise exception 'Class session is unavailable' using errcode='22023'; end if;
  select * into c from public.club_customers where organisation_id=s.organisation_id and user_id=auth.uid();
  if auth.uid() is null or not found then raise exception 'Member booking is unavailable' using errcode='42501'; end if;
  select * into existing from public.club_class_bookings where session_id=s.id and customer_id=c.id and status in ('confirmed','waitlisted');
  if found then if existing.funding_type='transformation_credit' then return to_jsonb(existing); end if; raise exception 'A booking already exists for this class' using errcode='23505'; end if;
  local_date:=(s.starts_at at time zone 'Europe/London')::date;
  week_year:=extract(isoyear from local_date)::integer; week_number:=extract(week from local_date)::integer;
  week_key:=week_year::text||'-W'||lpad(week_number::text,2,'0');
  -- Lock every eligible grant for this member in stable order. The single
  -- state key below enforces one included class across all their packages.
  perform 1 from public.club_entitlement_grants x
    where x.organisation_id=s.organisation_id and x.user_id=auth.uid() and x.entitlement_key='included_class_credit'
      and x.starts_at<=s.starts_at and (x.ends_at is null or x.ends_at>s.starts_at) and coalesce(x.allowance_quantity,0)>=1
      and x.allowance_period='week'
      and (x.membership_id is null or exists(select 1 from public.club_memberships m where m.id=x.membership_id and m.organisation_id=x.organisation_id and m.status='active' and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)))
    order by x.id for update;
  if not found then raise exception 'No valid included class entitlement applies to this class week' using errcode='55000'; end if;
  if exists(select 1 from public.club_class_weekly_entitlement_state st where st.organisation_id=s.organisation_id and st.user_id=auth.uid() and st.entitlement_type='included_class_credit' and st.iso_week_year=week_year and st.iso_week_number=week_number and st.usage_status='used')
    or exists(select 1 from public.club_entitlement_usage u join public.club_entitlement_grants x on x.id=u.grant_id where x.organisation_id=s.organisation_id and x.user_id=auth.uid() and x.entitlement_key='included_class_credit' and u.period_key=week_key) then
    raise exception 'The included class credit for this week has already been used' using errcode='22023';
  end if;
  select * into g from public.club_entitlement_grants x
    where x.organisation_id=s.organisation_id and x.user_id=auth.uid() and x.entitlement_key='included_class_credit'
      and x.starts_at<=s.starts_at and (x.ends_at is null or x.ends_at>s.starts_at) and x.allowance_quantity>=1 and x.allowance_period='week'
      and (x.membership_id is null or exists(select 1 from public.club_memberships m where m.id=x.membership_id and m.organisation_id=x.organisation_id and m.status='active' and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)))
    order by x.id limit 1;
  if not found then raise exception 'No valid included class entitlement applies to this class week' using errcode='55000'; end if;
  insert into public.club_entitlement_usage(grant_id,user_id,period_key,quantity,reference)
    values(g.id,auth.uid(),week_key,1,s.id::text) returning id into usage_id;
  insert into public.club_class_bookings(organisation_id,session_id,customer_id,status,funding_type,entitlement_usage_id,payment_method,payment_status,payment_amount_minor,payment_currency)
    values(s.organisation_id,s.id,c.id,'confirmed','transformation_credit',usage_id,'transformation_credit','not_required',0,'GBP') returning * into booking;
  insert into public.club_class_weekly_entitlement_state(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number,grant_id,session_id,booking_id,usage_status)
    values(s.organisation_id,auth.uid(),'included_class_credit',week_year,week_number,g.id,s.id,booking.id,'used')
    on conflict(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number) do update
      set grant_id=excluded.grant_id,session_id=excluded.session_id,booking_id=excluded.booking_id,usage_status='used',used_at=now(),restored_at=null
      where public.club_class_weekly_entitlement_state.usage_status='restored'
    returning id into state_id;
  if state_id is null then raise exception 'The included class credit for this week has already been used' using errcode='23505'; end if;
  insert into public.club_class_weekly_entitlement_events(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number,session_id,booking_id,event_type,actor_user_id,idempotency_key)
    values(s.organisation_id,auth.uid(),'included_class_credit',week_year,week_number,s.id,booking.id,'used',auth.uid(),'included-use:'||booking.id::text);
  return to_jsonb(booking);
end; $$;
revoke all on function public.club_redeem_transformation_class_credit(uuid) from public,anon;
grant execute on function public.club_redeem_transformation_class_credit(uuid) to authenticated;

create or replace function public.club_redeem_reusable_class_credit(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; c public.club_customers%rowtype; cr public.club_reusable_class_credits%rowtype; booking public.club_class_bookings%rowtype; existing public.club_class_bookings%rowtype;
begin
  select * into s from public.club_class_sessions where id=p_session_id for update;
  if not found or s.status<>'scheduled' or s.starts_at<=now() or s.capacity>6 then raise exception 'Class session is unavailable' using errcode='22023'; end if;
  select * into c from public.club_customers where organisation_id=s.organisation_id and user_id=auth.uid();
  if auth.uid() is null or not found then raise exception 'Member booking is unavailable' using errcode='42501'; end if;
  select * into existing from public.club_class_bookings where session_id=s.id and customer_id=c.id and status in ('confirmed','waitlisted');
  if found then if existing.funding_type='class_credit' then return to_jsonb(existing); end if; raise exception 'A booking already exists for this class' using errcode='23505'; end if;
  select * into cr from public.club_reusable_class_credits where organisation_id=s.organisation_id and customer_id=c.id and redeemed_at is null and expires_at>now() order by expires_at,issued_at,id limit 1 for update;
  if not found then raise exception 'No unexpired class credit is available' using errcode='55000'; end if;
  insert into public.club_class_bookings(organisation_id,session_id,customer_id,status,funding_type,class_credit_id,payment_method,payment_status,payment_amount_minor,payment_currency)
    values(s.organisation_id,s.id,c.id,'confirmed','class_credit',cr.id,'class_credit','paid',0,'GBP') returning * into booking;
  update public.club_reusable_class_credits set redeemed_at=now(),redeemed_booking_id=booking.id where id=cr.id;
  insert into public.club_reusable_class_credit_events(organisation_id,credit_id,customer_id,event_type,source_booking_id,related_booking_id,actor_user_id,idempotency_key)
    values(s.organisation_id,cr.id,c.id,'redeemed',cr.original_booking_id,booking.id,auth.uid(),'class-credit-redeem:'||booking.id::text);
  return to_jsonb(booking);
end; $$;
revoke all on function public.club_redeem_reusable_class_credit(uuid) from public,anon;
grant execute on function public.club_redeem_reusable_class_credit(uuid) to authenticated;

create or replace function public.club_cancel_class_booking(p_booking_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype; c public.club_customers%rowtype; s public.club_class_sessions%rowtype; session_ref uuid;
  staff boolean; restored_usage uuid; credit public.club_reusable_class_credits%rowtype; week_year integer; week_number integer; week_key text; user_cancel boolean; credit_expiry timestamptz;
begin
  select session_id into session_ref from public.club_class_bookings where id=p_booking_id;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into s from public.club_class_sessions where id=session_ref for update;
  if not found then raise exception 'Class session not found' using errcode='P0002'; end if;
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into c from public.club_customers where id=b.customer_id;
  staff:=public.club_has_active_role(b.organisation_id,array['gym_staff','gym_admin','owner']) or s.host_user_id=auth.uid();
  if auth.uid() is null or (c.user_id is distinct from auth.uid() and not staff) then raise exception 'Booking cancellation is not permitted' using errcode='42501'; end if;
  if b.status='cancelled' then return to_jsonb(b); end if;
  if not staff and s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at then raise exception 'Cancellation window is closed' using errcode='22023'; end if;
  user_cancel:=c.user_id=auth.uid() and not staff;
  week_year:=extract(isoyear from (s.starts_at at time zone 'Europe/London')::date)::integer;
  week_number:=extract(week from (s.starts_at at time zone 'Europe/London')::date)::integer;
  week_key:=week_year::text||'-W'||lpad(week_number::text,2,'0');
  if b.funding_type='transformation_credit' then
    if b.entitlement_usage_id is null then raise exception 'Transformation booking has no linked allowance use' using errcode='55000'; end if;
    delete from public.club_entitlement_usage where id=b.entitlement_usage_id returning id into restored_usage;
    if restored_usage is null then raise exception 'Included class allowance could not be restored' using errcode='55000'; end if;
    update public.club_class_weekly_entitlement_state set usage_status='restored',booking_id=null,restored_at=now()
      where organisation_id=b.organisation_id and user_id=c.user_id and entitlement_type='included_class_credit' and iso_week_year=week_year and iso_week_number=week_number and booking_id=b.id;
    insert into public.club_class_weekly_entitlement_events(organisation_id,user_id,entitlement_type,iso_week_year,iso_week_number,session_id,booking_id,event_type,actor_user_id,idempotency_key)
      values(b.organisation_id,c.user_id,'included_class_credit',week_year,week_number,s.id,b.id,'restored',auth.uid(),'included-restore:'||b.id::text) on conflict(organisation_id,idempotency_key) do nothing;
  elsif b.funding_type in ('payg','class_credit') and b.payment_status='paid' then
    if c.user_id is null then raise exception 'Class credit owner is unresolved' using errcode='55000'; end if;
    credit_expiry:=now()+case when user_cancel then interval '1 month' else interval '6 months' end;
    if b.funding_type='class_credit' and b.class_credit_id is not null then
      select least(credit_expiry,expires_at) into credit_expiry from public.club_reusable_class_credits where id=b.class_credit_id;
      if credit_expiry is null then raise exception 'Original reusable class credit could not be verified' using errcode='55000'; end if;
    end if;
    insert into public.club_reusable_class_credits(organisation_id,customer_id,original_booking_id,cancellation_booking_id,original_funding_method,original_source_reference,session_id,location_id,issuing_actor_type,issued_by,expires_at)
      values(b.organisation_id,c.id,b.id,b.id,b.funding_type,coalesce(b.payment_reference,b.class_credit_id::text),s.id,s.location_id,case when user_cancel then 'member_cancellation' else 'madhouse_cancellation' end,auth.uid(),credit_expiry)
      on conflict(cancellation_booking_id) do update set cancellation_booking_id=excluded.cancellation_booking_id returning * into credit;
    insert into public.club_reusable_class_credit_events(organisation_id,credit_id,customer_id,event_type,source_booking_id,actor_user_id,idempotency_key)
      values(b.organisation_id,credit.id,c.id,'issued',b.id,auth.uid(),'class-credit-issue:'||b.id::text) on conflict(organisation_id,idempotency_key) do nothing;
  elsif b.funding_type not in ('payg','class_credit','legacy_unknown') then raise exception 'Unsupported class booking funding source' using errcode='55000'; end if;
  insert into public.club_class_booking_cancellations(booking_id,organisation_id,funding_type,customer_id,session_id,location_id,original_booked_at,class_starts_at,late_cancellation,reason,actor_user_id,entitlement_usage_restored_id,reusable_credit_id,management_note)
    values(b.id,b.organisation_id,b.funding_type,b.customer_id,b.session_id,s.location_id,b.booked_at,s.starts_at,s.cancellation_closes_at is not null and now()>=s.cancellation_closes_at,nullif(btrim(p_reason),''),auth.uid(),restored_usage,credit.id,case when b.funding_type='legacy_unknown' then 'Legacy funding source unresolved; no automatic credit inferred' end);
  update public.club_class_bookings set status='cancelled',cancelled_at=now(),updated_at=now() where id=b.id returning * into b;
  return to_jsonb(b);
end; $$;
drop function if exists public.club_cancel_class_booking(uuid);
revoke all on function public.club_cancel_class_booking(uuid,text) from public,anon;
grant execute on function public.club_cancel_class_booking(uuid,text) to authenticated;

create or replace function public.club_list_my_class_credits(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare customer uuid; org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select c.id into customer from public.club_customers c where c.user_id=auth.uid() and c.organisation_id=p_organisation_id and c.status='member' limit 1;
  org:=p_organisation_id;
  if customer is null then return jsonb_build_object('credits','[]'::jsonb,'history','[]'::jsonb); end if;
  return jsonb_build_object(
    'credits',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'issuedAt',x.issued_at,'expiresAt',x.expires_at,'status',case when x.redeemed_at is not null then 'used' when x.expires_at<=now() then 'expired' else 'available' end,'originalBookingId',x.original_booking_id,'fundingMethod',x.original_funding_method,'issuer',x.issuing_actor_type,'redemptionAt',x.redeemed_at) order by x.issued_at desc) from public.club_reusable_class_credits x where x.customer_id=customer),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('eventType',e.event_type,'bookingId',e.related_booking_id,'sourceBookingId',e.source_booking_id,'occurredAt',e.occurred_at) order by e.occurred_at desc) from public.club_reusable_class_credit_events e where e.customer_id=customer),'[]'::jsonb),
    'weeklyEntitlements',coalesce((select jsonb_agg(jsonb_build_object('sessionId',q.id,'classWeek',q.week_key,'isoWeekYear',q.week_year,'isoWeekNumber',q.week_number,'status',case when q.has_entitlement and not q.used then 'available' when q.used then 'used' else 'not_included' end) order by q.starts_at)
      from (select s.id,s.starts_at,(extract(isoyear from (s.starts_at at time zone 'Europe/London')::date))::integer week_year,
        (extract(week from (s.starts_at at time zone 'Europe/London')::date))::integer week_number,
        extract(isoyear from (s.starts_at at time zone 'Europe/London')::date)::integer::text||'-W'||lpad(extract(week from (s.starts_at at time zone 'Europe/London')::date)::integer::text,2,'0') week_key,
        exists(select 1 from public.club_entitlement_grants g where g.organisation_id=s.organisation_id and g.user_id=auth.uid() and g.entitlement_key='included_class_credit' and g.allowance_quantity>=1 and g.allowance_period='week' and g.starts_at<=s.starts_at and (g.ends_at is null or g.ends_at>s.starts_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m where m.id=g.membership_id and m.status='active' and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)))) has_entitlement,
        exists(select 1 from public.club_class_weekly_entitlement_state st where st.organisation_id=s.organisation_id and st.user_id=auth.uid() and st.iso_week_year=extract(isoyear from (s.starts_at at time zone 'Europe/London')::date)::integer and st.iso_week_number=extract(week from (s.starts_at at time zone 'Europe/London')::date)::integer and st.usage_status='used')
          or exists(select 1 from public.club_entitlement_usage u join public.club_entitlement_grants g on g.id=u.grant_id where g.organisation_id=s.organisation_id and g.user_id=auth.uid() and g.entitlement_key='included_class_credit' and u.period_key=extract(isoyear from (s.starts_at at time zone 'Europe/London')::date)::integer::text||'-W'||lpad(extract(week from (s.starts_at at time zone 'Europe/London')::date)::integer::text,2,'0')) used
        from public.club_class_sessions s where s.organisation_id=org and s.status='scheduled' and s.starts_at>now()) q),'[]'::jsonb));
end; $$;
revoke all on function public.club_list_my_class_credits(uuid) from public,anon;
grant execute on function public.club_list_my_class_credits(uuid) to authenticated;

create or replace function public.club_list_class_booking_cancellations(p_organisation_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare items jsonb; repeats jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Class cancellation report is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '93 days' then raise exception 'Invalid cancellation report window' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bookingId',x.booking_id,'memberId',x.customer_id,'classSessionId',x.session_id,'locationId',x.location_id,'originalBookingDate',x.original_booked_at,'classStartsAt',x.class_starts_at,'fundingType',x.funding_type,'creditIssued',x.reusable_credit_id is not null or x.class_credit_entry_id is not null,'entitlementRestored',x.entitlement_usage_restored_id is not null,'lateCancellation',x.late_cancellation,'actorUserId',x.actor_user_id,'cancelledAt',x.cancelled_at,'reason',x.reason,'managementNote',x.management_note) order by x.cancelled_at desc),'[]'::jsonb)
    into items from public.club_class_booking_cancellations x where x.organisation_id=p_organisation_id and x.cancelled_at>=p_from and x.cancelled_at<p_to;
  select coalesce(jsonb_agg(jsonb_build_object('memberId',d.customer_id,'cancellationCount',d.n) order by d.n desc),'[]'::jsonb) into repeats
    from (select x.customer_id,count(*)::integer n from public.club_class_booking_cancellations x where x.organisation_id=p_organisation_id and x.cancelled_at>=p_from and x.cancelled_at<p_to group by x.customer_id having count(*)>1) d;
  return jsonb_build_object('cancellations',items,'repeatCancellations',repeats);
end; $$;
revoke all on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) to authenticated;
-- END 2027-01-07-madhouse-class-credit-iso-weeks.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql';
if recorded is not null and recorded<>'89c407d836cc9605297c4e27573ad381e83020ab700967242ab3e1044733cdaa' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql','89c407d836cc9605297c4e27573ad381e83020ab700967242ab3e1044733cdaa','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

-- BEGIN 2027-01-08-madhouse-daily-checks-import.sql
-- Madhouse cleaning tasks use the existing Club checklists, cycles and staff
-- completion history. Seeding is a management RPC so the real actor is audited.
alter table public.club_checklist_templates add column if not exists source_key text;
alter table public.club_checklist_template_locations alter column assigned_by drop not null;
alter table public.club_checklist_items add column if not exists source_key text;
alter table public.club_checklist_items add column if not exists scheduled_weekday smallint check(scheduled_weekday between 1 and 7);
alter table public.club_checklist_templates alter column created_by drop not null;
alter table public.club_checklist_items alter column created_by drop not null;
create unique index if not exists club_checklist_template_source_key_uq on public.club_checklist_templates(organisation_id,source_key) where source_key is not null;
create unique index if not exists club_checklist_item_source_key_uq on public.club_checklist_items(template_id,source_key) where source_key is not null;

create or replace function public.club_madhouse_seed_daily_checks(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare actor_role text; loc record; template_id uuid; item record; inserted integer:=0; location_id uuid; matches integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Daily check setup is restricted to authorised management' using errcode='42501'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for loc in select * from (values('Rotherham','Rotherham'),('Carlton','Carlton')) as x(location_key,location_name) loop
    select count(*),min(l.id::text)::uuid into matches,location_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(loc.location_name);
    if matches<>1 then raise exception 'Daily checks require exactly one active % location',loc.location_name using errcode='55000'; end if;
    insert into public.club_checklist_templates(organisation_id,name,check_type,active,created_by,source_key)
      values(p_organisation_id,'Madhouse daily checks · '||loc.location_name,'daily',true,auth.uid(),'madhouse-daily-'||lower(loc.location_key))
      on conflict(organisation_id,source_key) where source_key is not null do update set name=excluded.name,check_type='daily',active=true,updated_at=now() returning id into template_id;
    insert into public.club_checklist_template_locations(template_id,organisation_id,location_id,assigned_by)
      values(template_id,p_organisation_id,location_id,auth.uid()) on conflict(template_id,location_id) do nothing;
    for item in select * from (values
      ('routine-bins','Routine','Empty bins when full',null::smallint),
      ('routine-hoover','Routine','Hoover',null::smallint),
      ('routine-touch-points','Routine','Wipe touch points',null::smallint),
      ('routine-upholstery','Routine','Spray-clean equipment upholstery',null::smallint),
      ('routine-metal-frames','Routine','Clean equipment metal frames',null::smallint),
      ('routine-reception','Routine','Organise reception and desk area',null::smallint),
      ('routine-weights','Routine','Return loose weights to correct positions',null::smallint),
      ('monday-toilets','Scheduled','Deep-clean toilets',1::smallint),
      ('tuesday-mirrors','Scheduled',case when loc.location_key='Carlton' then 'Clean gym, toilet and sunbed mirrors' else 'Clean gym and toilet mirrors' end,2::smallint),
      ('thursday-toilets','Scheduled','Deep-clean toilets',4::smallint),
      ('carlton-tuesday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',2::smallint),
      ('carlton-saturday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',6::smallint),
      ('rotherham-wednesday-mats','Scheduled','Steam-clean mats · Rotherham',3::smallint),
      ('carlton-thursday-mats','Scheduled','Steam-clean mats · Carlton',4::smallint)
    ) as x(item_key,section,label,weekday) where
      (loc.location_key='Carlton' or item_key not in ('carlton-tuesday-sunbeds','carlton-saturday-sunbeds','carlton-thursday-mats'))
      and (loc.location_key='Rotherham' or item_key<>'rotherham-wednesday-mats') loop
      insert into public.club_checklist_items(template_id,organisation_id,section,label,required,sort_order,active,created_by,source_key,scheduled_weekday)
        values(template_id,p_organisation_id,item.section,item.label,true,case when item.weekday is null then 10 else 20+item.weekday end,true,auth.uid(),item.item_key,item.weekday)
        on conflict(template_id,source_key) where source_key is not null do update set section=excluded.section,label=excluded.label,required=true,sort_order=excluded.sort_order,active=true,scheduled_weekday=excluded.scheduled_weekday,updated_at=now();
      inserted:=inserted+1;
    end loop;
    perform public.club_append_audit_event(p_organisation_id,'venue.madhouse_checks_seeded','checklist_template',template_id,location_id,null,jsonb_build_object('source','madhouse-weekly-checks','actor_role',actor_role));
  end loop;
  return jsonb_build_object('templates',2,'items',inserted,'locations',2);
end; $$;
revoke all on function public.club_madhouse_seed_daily_checks(uuid) from public,anon;
grant execute on function public.club_madhouse_seed_daily_checks(uuid) to authenticated;

create or replace function public.club_validate_madhouse_check_weekday()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare weekday_due smallint; check_date date;
begin
  select i.scheduled_weekday,cy.operational_date into weekday_due,check_date from public.club_checklist_items i join public.club_checklist_cycles cy on cy.id=new.cycle_id and cy.organisation_id=new.organisation_id where i.id=new.item_id and i.organisation_id=new.organisation_id;
  if weekday_due is not null and weekday_due<>extract(isodow from check_date)::smallint then raise exception 'This scheduled check is not due today' using errcode='22023'; end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_check_weekday_guard on public.club_checklist_item_checks;
create trigger club_madhouse_check_weekday_guard before insert or update of cycle_id,item_id on public.club_checklist_item_checks for each row execute function public.club_validate_madhouse_check_weekday();

create or replace function public.club_get_venue_daily_checks(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; template_ids uuid[]; item_total integer; item_done integer; equipment_total integer; equipment_done integer; unresolved integer;
begin
  if auth.uid() is null or not public.club_location_authorized(p_organisation_id,p_location_id) or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_submit') or public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review')) then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date();
  select coalesce(array_agg(distinct t.id),'{}') into template_ids from public.club_checklist_templates t join public.club_checklist_template_locations tl on tl.template_id=t.id and tl.location_id=p_location_id and tl.organisation_id=p_organisation_id where t.organisation_id=p_organisation_id and t.active and t.check_type='daily';
  select count(*) into item_total from public.club_checklist_items i where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date));
  select count(*) into item_done from public.club_checklist_item_checks c join public.club_checklist_items i on i.id=c.item_id where c.cycle_id=cycle.id and c.status is not null and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date));
  select count(*) into equipment_total from public.club_equipment_assets where organisation_id=p_organisation_id and location_id=p_location_id and active;
  select count(*) into equipment_done from public.club_equipment_checks c join public.club_equipment_assets a on a.id=c.asset_id where c.cycle_id=cycle.id and a.active;
  select count(*) into unresolved from public.club_maintenance_issues where organisation_id=p_organisation_id and location_id=p_location_id and status not in ('resolved','closed');
  return jsonb_build_object('cycle',to_jsonb(cycle)||jsonb_build_object('submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=cycle.submitted_by),'Staff')),'item_total',item_total,'item_done',item_done,'equipment_total',equipment_total,'equipment_done',equipment_done,'total',item_total+equipment_total,'completed',item_done+equipment_done,'unresolved_issues',unresolved,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'section',i.section,'label',i.label,'required',i.required,'sort_order',i.sort_order,'status',c.status,'note',c.note,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by i.sort_order,i.label) from public.club_checklist_items i left join public.club_checklist_item_checks c on c.item_id=i.id and c.cycle_id=cycle.id where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date))),'[]'::jsonb),
    'equipment',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'category',a.category,'manufacturer',a.manufacturer,'model',a.model,'serial_reference',a.serial_reference,'operational_status',a.operational_status,'status',c.status,'note',c.note,'media_reference',c.media_reference,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by a.name) from public.club_equipment_assets a left join public.club_equipment_checks c on c.asset_id=a.id and c.cycle_id=cycle.id where a.organisation_id=p_organisation_id and a.location_id=p_location_id and a.active),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'priority',x.priority,'status',x.status,'out_of_service',x.out_of_service,'reported_at',x.reported_at,'reported_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reported_by),'Staff'),'reviewer_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reviewer_user_id),'Not reviewed'),'resolution_note',x.resolution_note,'history',coalesce((select jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'note',h.note,'created_at',h.created_at,'actor_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=h.actor_user_id),'Staff')) order by h.created_at) from public.club_maintenance_issue_history h where h.issue_id=x.id),'[]'::jsonb)) order by x.reported_at desc) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=p_location_id),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'check_type',t.check_type,'active',t.active,'assigned',exists(select 1 from public.club_checklist_template_locations z where z.template_id=t.id and z.location_id=p_location_id)) order by t.name) from public.club_checklist_templates t where t.organisation_id=p_organisation_id),'[]'::jsonb));
end; $$;
revoke all on function public.club_get_venue_daily_checks(uuid,uuid),public.club_validate_madhouse_check_weekday() from public,anon;
grant execute on function public.club_get_venue_daily_checks(uuid,uuid) to authenticated;

create or replace function public.club_list_venue_check_overview(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('location_id',l.id,'location_name',l.name,'item_total',coalesce((select count(*) from public.club_checklist_items i join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where i.organisation_id=p_organisation_id and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from public.club_venue_operational_date()))),0),'item_done',coalesce((select count(*) from public.club_checklist_item_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id join public.club_checklist_items i on i.id=c.item_id join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date() and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from public.club_venue_operational_date()))),0),'equipment_total',coalesce((select count(*) from public.club_equipment_assets a where a.organisation_id=p_organisation_id and a.location_id=l.id and a.active),0),'equipment_done',coalesce((select count(*) from public.club_equipment_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),0),'submitted',coalesce((select cy.status='submitted' from public.club_checklist_cycles cy where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),false),'submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p join public.club_checklist_cycles cy on cy.submitted_by=p.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),'Not submitted'),'unresolved_issues',coalesce((select count(*) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=l.id and x.status not in ('resolved','closed')),0)) order by l.name),'[]'::jsonb)
  from public.club_locations l where l.organisation_id=p_organisation_id and l.active and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review');
$$;

revoke all on function public.club_list_venue_check_overview(uuid) from public,anon;
grant execute on function public.club_list_venue_check_overview(uuid) to authenticated;
-- END 2027-01-08-madhouse-daily-checks-import.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql';
if recorded is not null and recorded<>'d590f5d58c23da0e0b3e704d925b669e520608b4d967b1d176333dd2872db037' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql','d590f5d58c23da0e0b3e704d925b669e520608b4d967b1d176333dd2872db037','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

-- BEGIN 2027-01-09-madhouse-class-payments-and-register.sql
-- Member PAYG reservations, Products & Services Stripe settlement, and cash audit.
-- All prices and identities are derived from database rows; webhook execution is
-- service-role-only and requires the application to verify Stripe's signature.

alter table public.club_class_bookings drop constraint if exists club_class_bookings_status_check;
alter table public.club_class_bookings add constraint club_class_bookings_status_check
  check(status in ('confirmed','cancelled','waitlisted','pending_payment','cash_due','payment_failed'));
alter table public.club_class_bookings add column if not exists payment_method text;
alter table public.club_class_bookings add column if not exists payment_status text not null default 'not_required';
alter table public.club_class_bookings add column if not exists payment_amount_minor integer;
alter table public.club_class_bookings add column if not exists payment_currency text;
alter table public.club_class_bookings add column if not exists stripe_checkout_session_id text;
alter table public.club_class_bookings add column if not exists stripe_payment_intent_id text;
-- A credit-funded cancellation keeps the source credit's original expiration.
-- If cancelled after that date, record an immediately expired credit instead
-- of failing cancellation or silently extending the original value.
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint where conrelid='public.club_reusable_class_credits'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%expires_at > issued_at%' loop
    execute format('alter table public.club_reusable_class_credits drop constraint %I',constraint_name);
  end loop;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.club_class_bookings'::regclass and conname='club_class_booking_payment_method_chk') then
    alter table public.club_class_bookings add constraint club_class_booking_payment_method_chk
      check(payment_method is null or payment_method in ('stripe','gym_drop_box','staff_cash','class_credit','transformation_credit','legacy_unknown'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_class_bookings'::regclass and conname='club_class_booking_payment_state_chk') then
    alter table public.club_class_bookings add constraint club_class_booking_payment_state_chk
      check(payment_status in ('not_required','pending','unverified','paid','failed','cancelled'));
  end if;
end $$;
drop index if exists public.club_class_bookings_active_customer_unique;
create unique index if not exists club_class_bookings_active_customer_unique on public.club_class_bookings(session_id,customer_id)
  where status in ('confirmed','waitlisted','pending_payment','cash_due');
create unique index if not exists club_class_bookings_stripe_checkout_uq on public.club_class_bookings(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create unique index if not exists club_class_bookings_stripe_intent_uq on public.club_class_bookings(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create table if not exists public.club_class_payment_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  booking_id uuid not null references public.club_class_bookings(id) on delete restrict,
  event_key text not null, event_type text not null, payment_method text not null,
  amount_minor integer not null check(amount_minor>=0), currency text not null check(currency ~ '^[A-Z]{3}$'),
  provider_reference text, actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
  unique(organisation_id,event_key)
);
create table if not exists public.club_class_cash_collections (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  booking_id uuid not null unique references public.club_class_bookings(id) on delete restrict,
  customer_id uuid not null references public.club_customers(id) on delete restrict,
  session_id uuid not null references public.club_class_sessions(id) on delete restrict,
  location_id uuid not null references public.club_locations(id) on delete restrict,
  amount_minor integer not null default 1000 check(amount_minor=1000), currency text not null default 'GBP' check(currency='GBP'),
  payment_method text not null check(payment_method in ('gym_drop_box','staff_cash')),
  collection_status text not null check(collection_status in ('unverified','verified')),
  collector_user_id uuid references auth.users(id) on delete set null, verified_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(), collected_at timestamptz, verified_at timestamptz,
  audit_reference text not null unique, note text,
  check((collection_status='verified' and verified_at is not null and collected_at is not null and verified_by is not null)
    or (collection_status='unverified' and verified_at is null and collected_at is null))
);
create index if not exists club_class_cash_due_by_session_idx on public.club_class_cash_collections(organisation_id,session_id) where collection_status='unverified';
alter table public.club_class_payment_events enable row level security;
alter table public.club_class_cash_collections enable row level security;
revoke all on public.club_class_payment_events,public.club_class_cash_collections from public,anon,authenticated;

-- Include payment-pending and cash-due reservations in both serialized caps.
create or replace function public.club_enforce_madhouse_class_capacity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_class_sessions%rowtype; total_count integer; transformation_count integer; madhouse boolean;
begin
  if new.status not in ('confirmed','waitlisted','pending_payment','cash_due') then return new; end if;
  select lower(name)='madhouse gym' into madhouse from public.club_organisations where id=new.organisation_id;
  if not coalesce(madhouse,false) then return new; end if;
  select * into s from public.club_class_sessions where id=new.session_id and organisation_id=new.organisation_id for update;
  if not found then raise exception 'Class session unavailable' using errcode='P0002'; end if;
  if s.capacity is not null and s.capacity>6 then raise exception 'Madhouse class capacity cannot exceed six' using errcode='22023'; end if;
  if new.status in ('confirmed','pending_payment','cash_due') then
    select count(*) into total_count from public.club_class_bookings b where b.session_id=s.id and b.status in ('confirmed','pending_payment','cash_due') and b.id<>new.id;
    if total_count>=least(coalesce(s.capacity,6),6) then raise exception 'Class capacity reached' using errcode='22023'; end if;
    select count(*) into transformation_count from public.club_class_bookings b where b.session_id=s.id and b.status in ('confirmed','pending_payment','cash_due') and b.id<>new.id and (b.funding_type='transformation_credit' or b.entitlement_usage_id is not null);
    if (new.funding_type='transformation_credit' or new.entitlement_usage_id is not null) and transformation_count>=least(coalesce(s.max_transformation_credit_bookings,2),2) then raise exception 'Transformation included-class capacity reached' using errcode='22023'; end if;
  end if;
  return new;
end; $$;

create or replace function public.club_start_member_payg_class_booking(p_session_id uuid,p_payment_method text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; c public.club_customers%rowtype; b public.club_class_bookings%rowtype; cash public.club_class_cash_collections%rowtype; price integer; currency text;
begin
  if auth.uid() is null or p_payment_method is null or p_payment_method not in ('stripe','gym_drop_box') or nullif(btrim(p_idempotency_key),'') is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'Class booking request is invalid' using errcode='22023'; end if;
  select * into s from public.club_class_sessions where id=p_session_id for update;
  if not found or s.status<>'scheduled' or s.starts_at<=now() then raise exception 'Class session is unavailable' using errcode='22023'; end if;
  select * into c from public.club_customers where organisation_id=s.organisation_id and user_id=auth.uid() and status='member';
  if not found then raise exception 'Linked member account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id where m.organisation_id=s.organisation_id and h.user_id=auth.uid() and m.status='active' and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)) then raise exception 'An active membership must cover the class date' using errcode='42501'; end if;
  select cfg.payg_price_minor,cfg.currency into price,currency from public.club_madhouse_class_commercial_config cfg where cfg.organisation_id=s.organisation_id;
  if price is distinct from 1000 or currency is distinct from 'GBP' then raise exception 'PAYG class price is not configured at £10 GBP' using errcode='55000'; end if;
  select * into b from public.club_class_bookings where session_id=s.id and customer_id=c.id and status in ('confirmed','waitlisted','pending_payment','cash_due') for update;
  if found then
    if b.payment_method=p_payment_method and b.payment_status in ('pending','unverified') then return jsonb_build_object('booking',to_jsonb(b),'reused',true); end if;
    raise exception 'An active booking already exists for this class' using errcode='23505';
  end if;
  insert into public.club_class_bookings(organisation_id,session_id,customer_id,status,funding_type,payment_method,payment_status,payment_amount_minor,payment_currency)
    values(s.organisation_id,s.id,c.id,case when p_payment_method='stripe' then 'pending_payment' else 'cash_due' end,'payg',p_payment_method,case when p_payment_method='stripe' then 'pending' else 'unverified' end,price,currency) returning * into b;
  insert into public.club_class_payment_events(organisation_id,booking_id,event_key,event_type,payment_method,amount_minor,currency,actor_user_id,metadata)
    values(s.organisation_id,b.id,'class-booking:'||b.id::text,'booking_created',p_payment_method,price,currency,auth.uid(),jsonb_build_object('idempotencyKey',p_idempotency_key));
  if p_payment_method='gym_drop_box' then
    insert into public.club_class_cash_collections(organisation_id,booking_id,customer_id,session_id,location_id,amount_minor,payment_method,collection_status,audit_reference)
      values(s.organisation_id,b.id,c.id,s.id,s.location_id,price,'gym_drop_box','unverified','class-cash-due:'||b.id::text) returning * into cash;
  end if;
  return jsonb_build_object('booking',to_jsonb(b),'cash',case when cash.id is null then null else to_jsonb(cash) end,'reused',false);
end; $$;
revoke all on function public.club_start_member_payg_class_booking(uuid,text,text) from public,anon;
grant execute on function public.club_start_member_payg_class_booking(uuid,text,text) to authenticated;

create or replace function public.club_get_class_availability(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; reserved integer; waiting integer;
begin
  select * into s from public.club_class_sessions where id=p_session_id;
  if not found then raise exception 'Class session not found' using errcode='P0002'; end if;
  if auth.uid() is null or not (public.club_has_active_role(s.organisation_id,array['gym_staff','gym_admin','owner']) or s.host_user_id=auth.uid() or (s.visibility='public' and public.club_has_customer_access(s.organisation_id)) or (s.visibility='members_only' and public.club_has_active_role(s.organisation_id,array['member','trainer','gym_staff','gym_admin','owner']))) then raise exception 'Class availability is not permitted' using errcode='42501'; end if;
  select count(*) filter(where status in ('confirmed','pending_payment','cash_due')),count(*) filter(where status='waitlisted') into reserved,waiting from public.club_class_bookings where session_id=s.id;
  return jsonb_build_object('session_id',s.id,'capacity',least(coalesce(s.capacity,6),6),'confirmed_count',reserved,'spaces_remaining',greatest(least(coalesce(s.capacity,6),6)-reserved,0),'waitlisted_count',waiting,'is_full',reserved>=least(coalesce(s.capacity,6),6));
end; $$;
revoke all on function public.club_get_class_availability(uuid) from public,anon;
grant execute on function public.club_get_class_availability(uuid) to authenticated;

create or replace function public.club_attach_class_stripe_checkout(p_booking_id uuid,p_checkout_id text,p_payment_intent_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype;
begin
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found or p_checkout_id is null or p_checkout_id !~ '^cs_[A-Za-z0-9]+$' or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$') or b.payment_method<>'stripe' or b.payment_status<>'pending' or b.customer_id not in (select id from public.club_customers where user_id=auth.uid()) then raise exception 'Stripe class payment is unavailable' using errcode='42501'; end if;
  if b.stripe_checkout_session_id is not null and b.stripe_checkout_session_id<>p_checkout_id then raise exception 'A checkout is already attached' using errcode='23505'; end if;
  update public.club_class_bookings set stripe_checkout_session_id=p_checkout_id,stripe_payment_intent_id=coalesce(p_payment_intent_id,stripe_payment_intent_id),updated_at=now() where id=b.id returning * into b;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_attach_class_stripe_checkout(uuid,text,text) from public,anon;
grant execute on function public.club_attach_class_stripe_checkout(uuid,text,text) to authenticated;

create or replace function public.club_abort_class_stripe_booking(p_booking_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype;
begin
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found or b.payment_method<>'stripe' or b.payment_status<>'pending' or b.customer_id not in (select id from public.club_customers where user_id=auth.uid()) then raise exception 'Pending Stripe class booking not found' using errcode='42501'; end if;
  update public.club_class_bookings set status='payment_failed',payment_status='failed',updated_at=now() where id=b.id returning * into b;
  insert into public.club_class_payment_events(organisation_id,booking_id,event_key,event_type,payment_method,amount_minor,currency,actor_user_id,metadata)
    values(b.organisation_id,b.id,'stripe-start-failed:'||b.id::text,'checkout_creation_failed','stripe',coalesce(b.payment_amount_minor,1000),coalesce(b.payment_currency,'GBP'),auth.uid(),jsonb_build_object('reason',left(coalesce(p_reason,'provider_unavailable'),160))) on conflict(organisation_id,event_key) do nothing;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_abort_class_stripe_booking(uuid,text) from public,anon;
grant execute on function public.club_abort_class_stripe_booking(uuid,text) to authenticated;

create or replace function public.club_record_class_stripe_event(p_event_id text,p_event_type text,p_booking_id uuid,p_session_id uuid,p_checkout_id text,p_payment_intent_id text,p_amount_minor integer,p_currency text,p_paid boolean,p_event_time timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype; s public.club_class_sessions%rowtype; session_ref uuid; event_state text; event_method text;
begin
  if auth.role() is distinct from 'service_role' or p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' then raise exception 'Trusted Stripe event required' using errcode='42501'; end if;
  select session_id into session_ref from public.club_class_bookings where id=p_booking_id;
  if session_ref is distinct from p_session_id then raise exception 'Stripe class session mismatch' using errcode='22023'; end if;
  select * into s from public.club_class_sessions where id=p_session_id for update;
  if not found then raise exception 'Class session not found' using errcode='P0002'; end if;
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found or b.payment_method<>'stripe' or b.funding_type<>'payg' or b.session_id is distinct from p_session_id or b.payment_amount_minor is distinct from p_amount_minor or b.payment_currency is distinct from upper(p_currency) then raise exception 'Stripe event does not match class booking' using errcode='22023'; end if;
  if p_checkout_id is not null and b.stripe_checkout_session_id is not null and b.stripe_checkout_session_id<>p_checkout_id then raise exception 'Stripe checkout reference mismatch' using errcode='22023'; end if;
  if b.stripe_payment_intent_id is not null and p_payment_intent_id is not null and b.stripe_payment_intent_id<>p_payment_intent_id then raise exception 'Stripe payment reference mismatch' using errcode='22023'; end if;
  if p_paid then
    if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then raise exception 'Unsupported Stripe success event' using errcode='22023'; end if;
    if b.status='payment_failed' or b.status='cancelled' then raise exception 'Closed booking cannot be paid' using errcode='22023'; end if;
    if b.status='pending_payment' then
      if s.status<>'scheduled' then raise exception 'Class session is no longer available' using errcode='22023'; end if;
      update public.club_class_bookings set status='confirmed',payment_status='paid',payment_reference=coalesce(p_payment_intent_id,p_checkout_id),stripe_checkout_session_id=p_checkout_id,stripe_payment_intent_id=coalesce(p_payment_intent_id,stripe_payment_intent_id),updated_at=now() where id=b.id returning * into b;
    end if;
    event_state:='paid'; event_method:='stripe';
  else
    if p_event_type not in ('checkout.session.async_payment_failed','checkout.session.expired','payment_intent.payment_failed') then raise exception 'Unsupported Stripe failure event' using errcode='22023'; end if;
    if b.status='pending_payment' and p_event_type<>'payment_intent.payment_failed' then update public.club_class_bookings set status='payment_failed',payment_status=case when p_event_type='checkout.session.expired' then 'cancelled' else 'failed' end,updated_at=now() where id=b.id returning * into b; end if;
    event_state:=case when p_event_type='checkout.session.expired' then 'cancelled' when p_event_type='payment_intent.payment_failed' then 'retryable_failure' else 'failed' end; event_method:='stripe';
  end if;
  insert into public.club_class_payment_events(organisation_id,booking_id,event_key,event_type,payment_method,amount_minor,currency,provider_reference,occurred_at,metadata)
    values(b.organisation_id,b.id,p_event_id,p_event_type,event_method,p_amount_minor,upper(p_currency),coalesce(p_payment_intent_id,p_checkout_id),coalesce(p_event_time,now()),jsonb_build_object('result',event_state)) on conflict(organisation_id,event_key) do nothing;
  return jsonb_build_object('booking',to_jsonb(b),'result',event_state);
end; $$;
revoke all on function public.club_record_class_stripe_event(text,text,uuid,uuid,text,text,integer,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_class_stripe_event(text,text,uuid,uuid,text,text,integer,text,boolean,timestamptz) to service_role;

create or replace function public.club_record_class_cash_dropbox(p_booking_id uuid,p_reference text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype; c public.club_class_cash_collections%rowtype;
begin
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found or b.payment_method<>'gym_drop_box' or b.status<>'cash_due' then raise exception 'Cash-due booking not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(b.organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_reference),'') is null then raise exception 'A physical cash reconciliation reference is required' using errcode='22023'; end if;
  select * into c from public.club_class_cash_collections where booking_id=b.id for update;
  if c.collection_status='verified' then return jsonb_build_object('booking',to_jsonb(b),'cash',to_jsonb(c),'replayed',true); end if;
  update public.club_class_cash_collections set collection_status='verified',verified_by=auth.uid(),verified_at=now(),collected_at=now(),note=coalesce(nullif(btrim(p_note),''),note),audit_reference=coalesce(nullif(btrim(p_reference),''),audit_reference) where id=c.id returning * into c;
  update public.club_class_bookings set status='confirmed',payment_status='paid',payment_reference=c.audit_reference,updated_at=now() where id=b.id returning * into b;
  insert into public.club_class_payment_events(organisation_id,booking_id,event_key,event_type,payment_method,amount_minor,currency,provider_reference,actor_user_id,metadata)
    values(b.organisation_id,b.id,'cash-verified:'||b.id::text,'cash_verified','gym_drop_box',1000,'GBP',c.audit_reference,auth.uid(),jsonb_build_object('locationId',c.location_id,'cashCollectionId',c.id)) on conflict(organisation_id,event_key) do nothing;
  return jsonb_build_object('booking',to_jsonb(b),'cash',to_jsonb(c),'replayed',false);
end; $$;
revoke all on function public.club_record_class_cash_dropbox(uuid,text,text) from public,anon;
grant execute on function public.club_record_class_cash_dropbox(uuid,text,text) to authenticated;

create or replace function public.club_staff_collect_class_cash(p_session_id uuid,p_customer_id uuid,p_existing_booking_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; b public.club_class_bookings%rowtype; cash public.club_class_cash_collections%rowtype; c public.club_customers%rowtype;
begin
  select * into s from public.club_class_sessions where id=p_session_id for update;
  if not found or s.status<>'scheduled' or s.ends_at<=now() then raise exception 'Class session is unavailable' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(s.organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Cash collection is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=s.organisation_id and status='member';
  if not found then raise exception 'Member not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id where m.organisation_id=s.organisation_id and h.customer_id=c.id and m.status='active' and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)) then raise exception 'An active membership must cover the class date' using errcode='42501'; end if;
  if p_existing_booking_id is null then
    select * into b from public.club_class_bookings where session_id=s.id and customer_id=c.id and status in ('confirmed','cash_due','pending_payment','waitlisted') for update;
    if found then
      if b.status='confirmed' and b.payment_method='staff_cash' then select * into cash from public.club_class_cash_collections where booking_id=b.id; return jsonb_build_object('booking',to_jsonb(b),'cash',to_jsonb(cash),'replayed',true); end if;
      if b.status<>'cash_due' or b.payment_method<>'gym_drop_box' then raise exception 'Member already has an active class booking' using errcode='23505'; end if;
      select * into cash from public.club_class_cash_collections where booking_id=b.id for update;
      update public.club_class_cash_collections set payment_method='staff_cash',collection_status='verified',collector_user_id=auth.uid(),verified_by=auth.uid(),collected_at=now(),verified_at=now(),audit_reference='class-staff-cash:'||b.id::text where id=cash.id returning * into cash;
      update public.club_class_bookings set status='confirmed',payment_status='paid',payment_method='staff_cash',payment_reference=cash.audit_reference,updated_at=now() where id=b.id returning * into b;
    else
      if s.ends_at<=now() then raise exception 'Class has already ended' using errcode='22023'; end if;
      insert into public.club_class_bookings(organisation_id,session_id,customer_id,status,funding_type,payment_method,payment_status,payment_amount_minor,payment_currency)
        values(s.organisation_id,s.id,c.id,'confirmed','payg','staff_cash','paid',1000,'GBP') returning * into b;
      insert into public.club_class_cash_collections(organisation_id,booking_id,customer_id,session_id,location_id,amount_minor,payment_method,collection_status,collector_user_id,verified_by,issued_at,collected_at,verified_at,audit_reference)
        values(s.organisation_id,b.id,c.id,s.id,s.location_id,1000,'staff_cash','verified',auth.uid(),auth.uid(),now(),now(),now(),'class-staff-cash:'||b.id::text) returning * into cash;
    end if;
  else
    select * into b from public.club_class_bookings where id=p_existing_booking_id and session_id=s.id and customer_id=c.id and status='cash_due' and payment_method='gym_drop_box' for update;
    if not found then raise exception 'Existing cash-due booking not found' using errcode='P0002'; end if;
    if s.ends_at<=now() then raise exception 'Class has already ended' using errcode='22023'; end if;
    select * into cash from public.club_class_cash_collections where booking_id=b.id for update;
    if cash.collection_status='verified' then return jsonb_build_object('booking',to_jsonb(b),'cash',to_jsonb(cash),'replayed',true); end if;
    update public.club_class_cash_collections set payment_method='staff_cash',collection_status='verified',collector_user_id=auth.uid(),verified_by=auth.uid(),collected_at=now(),verified_at=now(),audit_reference='class-staff-cash:'||b.id::text where id=cash.id returning * into cash;
    update public.club_class_bookings set status='confirmed',payment_status='paid',payment_method='staff_cash',payment_reference=cash.audit_reference,updated_at=now() where id=b.id returning * into b;
  end if;
  insert into public.club_class_payment_events(organisation_id,booking_id,event_key,event_type,payment_method,amount_minor,currency,provider_reference,actor_user_id,metadata)
    values(s.organisation_id,b.id,'cash-verified:'||b.id::text,'cash_verified','staff_cash',1000,'GBP',cash.audit_reference,auth.uid(),jsonb_build_object('locationId',s.location_id,'cashCollectionId',cash.id)) on conflict(organisation_id,event_key) do nothing;
  return jsonb_build_object('booking',to_jsonb(b),'cash',to_jsonb(cash),'replayed',false);
end; $$;
revoke all on function public.club_staff_collect_class_cash(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_staff_collect_class_cash(uuid,uuid,uuid) to authenticated;

create or replace function public.club_get_host_class_register(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare s public.club_class_sessions%rowtype; roster jsonb; total integer; left_count integer;
begin
  select * into s from public.club_class_sessions where id=p_session_id;
  if not found or auth.uid() is null or (s.host_user_id is distinct from auth.uid() and not public.club_has_active_role(s.organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Class register is not permitted' using errcode='42501'; end if;
  select count(*) into total from public.club_class_bookings b where b.session_id=s.id and b.status in ('confirmed','cash_due','pending_payment');
  left_count:=greatest(least(coalesce(s.capacity,6),6)-total,0);
  select coalesce(jsonb_agg(jsonb_build_object('bookingId',b.id,'customerId',c.id,'memberName',c.display_name,'status',b.status,'attendanceState',b.attendance_state,'paymentMethod',b.payment_method,'paymentStatus',b.payment_status,'amountMinor',b.payment_amount_minor,'cashStatus',cc.collection_status,'cashDue',case when cc.collection_status='unverified' then cc.amount_minor else 0 end,'cancelledAt',b.cancelled_at) order by c.display_name),'[]'::jsonb) into roster
    from public.club_class_bookings b join public.club_customers c on c.id=b.customer_id left join public.club_class_cash_collections cc on cc.booking_id=b.id where b.session_id=s.id;
  return jsonb_build_object('sessionId',s.id,'capacity',least(coalesce(s.capacity,6),6),'reserved',total,'spacesRemaining',left_count,'roster',roster);
end; $$;
revoke all on function public.club_get_host_class_register(uuid) from public,anon;
grant execute on function public.club_get_host_class_register(uuid) to authenticated;

create or replace function public.club_staff_list_class_members(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare org uuid; items jsonb;
begin
  select organisation_id into org from public.club_class_sessions where id=p_session_id and status='scheduled';
  if org is null or auth.uid() is null or not public.club_capability_allowed(org,auth.uid(),'payments.record_cash') then raise exception 'Class cash booking is not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name) order by c.display_name),'[]'::jsonb) into items from public.club_customers c
    where c.organisation_id=org and c.status='member' and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id where m.organisation_id=org and h.customer_id=c.id and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
  return items;
end; $$;
revoke all on function public.club_staff_list_class_members(uuid) from public,anon;
grant execute on function public.club_staff_list_class_members(uuid) to authenticated;

create or replace function public.club_list_class_booking_cancellations(p_organisation_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare items jsonb; repeats jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') or public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile')) then raise exception 'Class cancellation report is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '93 days' then raise exception 'Invalid cancellation report window' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bookingId',x.booking_id,'memberId',x.customer_id,'memberName',c.display_name,'classSessionId',x.session_id,'className',coalesce(s.title,t.name),'venue',l.name,'originalBookingDate',x.original_booked_at,'classStartsAt',x.class_starts_at,'fundingType',x.funding_type,'creditIssued',x.reusable_credit_id is not null or x.class_credit_entry_id is not null,'entitlementRestored',x.entitlement_usage_restored_id is not null,'lateCancellation',x.late_cancellation,'cancellationActor',case when x.actor_user_id is not null and x.actor_user_id=c.user_id then 'member' else 'madhouse' end,'actorUserId',x.actor_user_id,'cancelledAt',x.cancelled_at,'reason',x.reason,'managementNote',x.management_note) order by x.cancelled_at desc),'[]'::jsonb)
    into items from public.club_class_booking_cancellations x left join public.club_customers c on c.id=x.customer_id left join public.club_class_sessions s on s.id=x.session_id left join public.club_class_types t on t.id=s.class_type_id left join public.club_locations l on l.id=x.location_id where x.organisation_id=p_organisation_id and x.cancelled_at>=p_from and x.cancelled_at<p_to;
  select coalesce(jsonb_agg(jsonb_build_object('memberId',d.customer_id,'memberName',c.display_name,'cancellationCount',d.n) order by d.n desc),'[]'::jsonb) into repeats
    from (select x.customer_id,count(*)::integer n from public.club_class_booking_cancellations x where x.organisation_id=p_organisation_id and x.cancelled_at>=p_from and x.cancelled_at<p_to group by x.customer_id having count(*)>1) d left join public.club_customers c on c.id=d.customer_id;
  return jsonb_build_object('cancellations',items,'repeatCancellations',repeats);
end; $$;
revoke all on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.club_list_class_booking_cancellations(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.club_list_class_credit_ledger(p_organisation_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare rows jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') or public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile')) then raise exception 'Class credit ledger is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '93 days' then raise exception 'Invalid class credit ledger window' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('creditId',cr.id,'memberId',c.id,'memberName',c.display_name,'classSessionId',s.id,'className',coalesce(s.title,t.name),'venue',l.name,'bookingId',cr.original_booking_id,'fundingMethod',cr.original_funding_method,'sourceReference',cr.original_source_reference,'issuer',cr.issuing_actor_type,'issuedBy',cr.issued_by,'issuedAt',cr.issued_at,'expiresAt',cr.expires_at,'status',case when cr.redeemed_at is not null then 'used' when cr.expires_at<=now() then 'expired' else 'available' end,'redeemedAt',cr.redeemed_at,'redeemedBookingId',cr.redeemed_booking_id,'events',coalesce((select jsonb_agg(jsonb_build_object('eventType',e.event_type,'occurredAt',e.occurred_at,'bookingId',e.related_booking_id,'actorUserId',e.actor_user_id) order by e.occurred_at) from public.club_reusable_class_credit_events e where e.credit_id=cr.id),'[]'::jsonb)) order by cr.issued_at desc),'[]'::jsonb)
    into rows from public.club_reusable_class_credits cr join public.club_customers c on c.id=cr.customer_id join public.club_class_sessions s on s.id=cr.session_id join public.club_class_types t on t.id=s.class_type_id join public.club_locations l on l.id=cr.location_id where cr.organisation_id=p_organisation_id and cr.issued_at>=p_from and cr.issued_at<p_to;
  return rows;
end; $$;
revoke all on function public.club_list_class_credit_ledger(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.club_list_class_credit_ledger(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.club_set_booking_attendance(p_booking_id uuid,p_attendance_state text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.club_class_bookings%rowtype; s public.club_class_sessions%rowtype;
begin
  select * into b from public.club_class_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into s from public.club_class_sessions where id=b.session_id;
  if auth.uid() is null or (not public.club_has_active_role(b.organisation_id,array['gym_staff','gym_admin','owner']) and s.host_user_id is distinct from auth.uid()) then raise exception 'Attendance update is not permitted' using errcode='42501'; end if;
  if b.status not in ('confirmed','cash_due') or p_attendance_state not in ('checked_in','attended','no_show') then raise exception 'Invalid attendance update' using errcode='22023'; end if;
  update public.club_class_bookings set attendance_state=p_attendance_state,updated_at=now() where id=b.id returning * into b;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_set_booking_attendance(uuid,text) from public,anon;
grant execute on function public.club_set_booking_attendance(uuid,text) to authenticated;
-- END 2027-01-09-madhouse-class-payments-and-register.sql
do $migration$ declare recorded text; begin select checksum into recorded from public.r12_schema_migrations where migration_name='supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql';
if recorded is not null and recorded<>'55e2fb75ebb130a6da06ba04c9eb07b235dadc114b42fb36627f75750e5a5fba' then raise exception 'Migration checksum mismatch for supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql'; end if;
insert into public.r12_schema_migrations(migration_name,checksum,source,note) values ('supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql','55e2fb75ebb130a6da06ba04c9eb07b235dadc114b42fb36627f75750e5a5fba','manual-forward-bundle','Madhouse class forward release') on conflict (migration_name) do nothing;
end $migration$;

commit;

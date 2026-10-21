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

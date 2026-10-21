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
    raise exception 'This week's included class has already been used' using errcode='22023';
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
  if state_id is null then raise exception 'This week's included class has already been used' using errcode='23505'; end if;
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

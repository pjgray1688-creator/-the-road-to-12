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

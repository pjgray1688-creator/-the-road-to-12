-- Madhouse public-join billing contract and versioned first-use tutorials.
-- Provider confirmations remain service-role only. This migration sends no
-- payment request, creates no provider credential and grants no Coach access.

alter table public.club_membership_join_requests
  drop constraint if exists club_join_payment_method_check;
alter table public.club_membership_join_requests
  add column if not exists checkout_kind text not null default 'one_off',
  add column if not exists joining_fee_minor integer not null default 0,
  add column if not exists first_period_minor integer not null default 0,
  add column if not exists upfront_amount_minor integer not null default 0,
  add column if not exists upfront_provider text,
  add column if not exists upfront_payment_state text not null default 'required',
  add column if not exists recurring_provider text,
  add column if not exists recurring_authority_state text not null default 'not_required',
  add column if not exists recurring_authority_reference text,
  add column if not exists billing_anchor_day integer,
  add column if not exists paid_through_at timestamptz,
  add constraint club_join_payment_method_check check(payment_method is null or payment_method in ('none','card','direct_debit','card_and_direct_debit','staff_manual')),
  add constraint club_join_checkout_kind_check check(checkout_kind in ('free','monthly_recurring','day_pass','week_pass','annual_one_off','one_off','manual')),
  add constraint club_join_amounts_check check(joining_fee_minor>=0 and first_period_minor>=0 and upfront_amount_minor=joining_fee_minor+first_period_minor),
  add constraint club_join_upfront_state_check check(upfront_payment_state in ('not_required','required','pending','failed','unavailable','confirmed')),
  add constraint club_join_recurring_state_check check(recurring_authority_state in ('not_required','required','pending','failed','unavailable','confirmed')),
  add constraint club_join_anchor_check check(billing_anchor_day is null or billing_anchor_day between 1 and 31);

-- The installed catalogue previously described Yearly as recurring. Madhouse
-- sells it as a paid 365-day period with an explicit renewal, not an automatic
-- annual collection.
update public.club_products p
set billing='one_off',duration_days=365
from public.club_organisations o
where p.organisation_id=o.id and o.slug='madhouse-gym' and p.name='Yearly Membership';

create table if not exists public.club_membership_join_provider_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  join_request_id uuid not null,
  provider_type text not null,
  provider_event_key text not null,
  event_type text not null check(event_type in ('upfront_confirmed','upfront_failed','mandate_confirmed','mandate_failed')),
  amount_minor integer,
  provider_reference text,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(organisation_id,provider_type,provider_event_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
alter table public.club_membership_join_provider_events enable row level security;
revoke all on table public.club_membership_join_provider_events from public,anon,authenticated;

alter table public.club_membership_billing_arrangements
  add column if not exists billing_anchor_day integer check(billing_anchor_day is null or billing_anchor_day between 1 and 31);

create or replace function public.club_membership_anniversary(p_from timestamptz,p_anchor_day integer,p_months integer default 1)
returns timestamptz language plpgsql immutable set search_path=pg_catalog,public as $$
declare base_date date; last_date date; target_date date; clock_time time;
begin
  if p_anchor_day not between 1 and 31 or p_months<1 then raise exception 'Invalid billing anniversary' using errcode='22023'; end if;
  base_date:=(date_trunc('month',p_from at time zone 'UTC')+make_interval(months=>p_months))::date;
  last_date:=(base_date+interval '1 month'-interval '1 day')::date;
  target_date:=base_date+(least(p_anchor_day,extract(day from last_date)::integer)-1);
  clock_time:=(p_from at time zone 'UTC')::time;
  return (target_date+clock_time) at time zone 'UTC';
end; $$;

create or replace function public.club_normalise_billing_anniversary()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare anchor integer;
begin
  anchor:=coalesce(new.billing_anchor_day,extract(day from new.next_due_at at time zone 'UTC')::integer);
  new.billing_anchor_day:=anchor;
  if tg_op='UPDATE' and new.next_due_at is distinct from old.next_due_at and new.frequency='monthly' then
    new.next_due_at:=public.club_membership_anniversary(old.next_due_at,anchor,1);
  end if;
  return new;
end; $$;
drop trigger if exists club_billing_arrangement_anniversary on public.club_membership_billing_arrangements;
create trigger club_billing_arrangement_anniversary before insert or update of next_due_at on public.club_membership_billing_arrangements
for each row execute function public.club_normalise_billing_anniversary();
revoke all on function public.club_membership_anniversary(timestamptz,integer,integer),public.club_normalise_billing_anniversary() from public,anon,authenticated;

create or replace function public.club_monthly_grace_only()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare anchor integer;
begin
  if new.arrangement_id is not null and new.frequency='monthly' then
    select billing_anchor_day into anchor from public.club_membership_billing_arrangements where id=new.arrangement_id and organisation_id=new.organisation_id;
    if anchor is not null then
      new.next_due_at:=public.club_membership_anniversary(new.next_due_at-interval '1 month',anchor,1);
      new.period_key:=to_char(new.next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
  end if;
  if new.frequency<>'monthly' and new.state='grace' then new.state:='failed'; new.grace_started_at:=null; end if;
  return new;
end; $$;
drop trigger if exists club_billing_monthly_grace_only on public.club_membership_billing_obligations;
create trigger club_billing_monthly_grace_only before insert or update on public.club_membership_billing_obligations
for each row execute function public.club_monthly_grace_only();
revoke all on function public.club_monthly_grace_only() from public,anon,authenticated;
update public.club_membership_billing_obligations set state='failed',grace_started_at=null where frequency<>'monthly' and state='grace';
update public.club_membership_payment_access_suspensions s set active=false,cleared_at=coalesce(cleared_at,now())
where active and exists(select 1 from public.club_membership_billing_obligations o where o.id=s.obligation_id and o.frequency<>'monthly');

create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,
    'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'sellable',p.sellable,
    'joining_fee_minor',case when p.billing='recurring' then coalesce(charges.joining_fee_minor,0) else 0 end,
    'joining_fee_configured',case when p.billing='recurring' then coalesce(charges.configured,false) else true end,
    'checkout_kind',case when p.price_minor=0 then 'free' when p.billing='recurring' then 'monthly_recurring'
      when p.duration_days=1 then 'day_pass' when p.duration_days=7 then 'week_pass'
      when p.duration_days>=365 then 'annual_one_off' else 'one_off' end
  )
  from public.club_products p
  join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  left join lateral (
    select sum(c.amount_minor)::integer joining_fee_minor,count(*)>0 configured from public.club_membership_initial_charges c
    where c.organisation_id=p.organisation_id and c.product_id=p.id and c.charge_type='joining_fee' and c.required and c.active
  ) charges on true
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
  order by p.name;
$$;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

create or replace function public.club_start_membership_joining(
  p_organisation_id uuid,p_product_id uuid,p_location_id uuid,p_first_name text,p_last_name text,
  p_email text,p_phone text,p_date_of_birth date,p_address_line_1 text,p_address_line_2 text,
  p_town_city text,p_postcode text,p_emergency_name text,p_emergency_phone text,
  p_terms_accepted boolean,p_privacy_accepted boolean,p_marketing_consent boolean,
  p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_auth record; v_customer public.club_customers%rowtype;
  v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
  v_status text; v_payment_state text; v_method text; v_checkout text; v_slug text;
  v_joining_fee integer:=0; v_first_period integer:=0; v_upfront integer:=0; v_fee_configured boolean:=false;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  select lower(btrim(email)) email,email_confirmed_at into v_auth from auth.users where id=v_user;
  if v_auth.email_confirmed_at is null then raise exception 'Confirm your email before joining' using errcode='42501'; end if;
  if v_auth.email is distinct from lower(btrim(p_email)) then raise exception 'Joining email must match the signed-in account' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null or nullif(btrim(p_phone),'') is null
    or p_date_of_birth is null or p_date_of_birth>=current_date or nullif(btrim(p_address_line_1),'') is null
    or nullif(btrim(p_postcode),'') is null or nullif(btrim(p_emergency_name),'') is null
    or nullif(btrim(p_emergency_phone),'') is null or not coalesce(p_terms_accepted,false)
    or not coalesce(p_privacy_accepted,false) or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Joining details are incomplete' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is unavailable' using errcode='22023'; end if;
  select p,o.slug into v_product,v_slug from public.club_products p join public.club_organisations o on o.id=p.organisation_id
    where p.id=p_product_id and p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null and o.active and o.member_joinable;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_checkout:=case when v_product.price_minor=0 then 'free' when v_product.billing='recurring' then 'monthly_recurring'
    when v_product.duration_days=1 then 'day_pass' when v_product.duration_days=7 then 'week_pass'
    when v_product.duration_days>=365 then 'annual_one_off' else 'one_off' end;
  if v_checkout='monthly_recurring' then
    select coalesce(sum(amount_minor),0)::integer,count(*)>0 into v_joining_fee,v_fee_configured from public.club_membership_initial_charges
      where organisation_id=p_organisation_id and product_id=v_product.id and charge_type='joining_fee' and required and active;
    if v_slug='madhouse-gym' and not v_fee_configured then raise exception 'Monthly joining fee is not configured' using errcode='55000'; end if;
  end if;
  v_first_period:=case when v_product.price_minor=0 then 0 else v_product.price_minor end;
  v_upfront:=v_joining_fee+v_first_period;
  v_method:=case when v_checkout='free' then 'none' when v_checkout='monthly_recurring' then 'card_and_direct_debit'
    when v_slug='madhouse-gym' then 'card' else coalesce(nullif(p_payment_method,''),'card') end;
  if v_method not in ('none','card','direct_debit','card_and_direct_debit','staff_manual') then raise exception 'Choose a valid payment route' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_auth.email and user_id is distinct from v_user) then raise exception 'An existing member record matches this email; claim it instead' using errcode='23505'; end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
      values(p_organisation_id,v_user,btrim(p_first_name)||' '||btrim(p_last_name),v_auth.email,btrim(p_phone),'customer') returning * into v_customer;
  end if;
  update public.club_customers set display_name=btrim(p_first_name)||' '||btrim(p_last_name),email=v_auth.email,phone=btrim(p_phone),
    first_name=btrim(p_first_name),last_name=btrim(p_last_name),date_of_birth=p_date_of_birth,address_line_1=btrim(p_address_line_1),
    address_line_2=nullif(btrim(p_address_line_2),''),town_city=nullif(btrim(p_town_city),''),postcode=upper(btrim(p_postcode)),
    emergency_contact_name=btrim(p_emergency_name),emergency_contact_phone=btrim(p_emergency_phone),
    terms_accepted_at=coalesce(terms_accepted_at,now()),privacy_accepted_at=coalesce(privacy_accepted_at,now()),
    marketing_consent=coalesce(p_marketing_consent,false),marketing_consent_at=case when p_marketing_consent then now() else null end,updated_at=now()
    where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name) values(v_user,v_auth.email,v_customer.display_name,btrim(p_first_name),btrim(p_last_name))
    on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name;
  insert into public.club_members(organisation_id,user_id,role,active,preferred_location_id) values(p_organisation_id,v_user,'member',true,p_location_id)
    on conflict(organisation_id,user_id) do update set active=true,preferred_location_id=excluded.preferred_location_id;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and status not in ('completed','cancelled') for update;
  v_status:=case when v_checkout='free' then 'ready_to_activate' when v_method='staff_manual' then 'staff_review' else 'payment_required' end;
  v_payment_state:=case when v_checkout='free' then 'not_required' when v_method='staff_manual' then 'pending' else 'unavailable' end;
  if found then
    update public.club_membership_join_requests set customer_id=v_customer.id,product_id=v_product.id,location_id=p_location_id,status=v_status,
      payment_method=v_method,payment_state=v_payment_state,payment_provider=case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,
      checkout_kind=v_checkout,joining_fee_minor=v_joining_fee,first_period_minor=v_first_period,upfront_amount_minor=v_upfront,
      upfront_provider=case when v_checkout='free' then null else 'stripe' end,upfront_payment_state=case when v_checkout='free' then 'not_required' else 'unavailable' end,
      recurring_provider=case when v_checkout='monthly_recurring' then 'gocardless' end,
      recurring_authority_state=case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      billing_anchor_day=case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end,
      paid_through_at=null,payment_failure_reason=null,last_activity_at=now(),reminder_eligible_at=case when v_upfront>0 then now()+interval '24 hours' end,updated_at=now()
      where id=v_request.id returning * into v_request;
  else
    insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,location_id,status,idempotency_key,payment_method,payment_state,payment_provider,last_activity_at,reminder_eligible_at,
      checkout_kind,joining_fee_minor,first_period_minor,upfront_amount_minor,upfront_provider,upfront_payment_state,recurring_provider,recurring_authority_state,billing_anchor_day)
    values(p_organisation_id,v_user,v_customer.id,v_product.id,p_location_id,v_status,btrim(p_idempotency_key),v_method,v_payment_state,
      case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,now(),case when v_upfront>0 then now()+interval '24 hours' end,
      v_checkout,v_joining_fee,v_first_period,v_upfront,case when v_checkout='free' then null else 'stripe' end,case when v_checkout='free' then 'not_required' else 'unavailable' end,
      case when v_checkout='monthly_recurring' then 'gocardless' end,case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end) returning * into v_request;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before)
    values(p_organisation_id,v_user,v_request.id,case when v_upfront>0 then 'billing' else 'member_service' end,'join_incomplete','unavailable','join-reminder:'||v_request.id,coalesce(v_request.reminder_eligible_at,now()+interval '24 hours'))
    on conflict(organisation_id,idempotency_key) do nothing;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.club_get_my_join_state(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select j.*,p.name product_name,p.price_minor,p.currency,p.billing,l.name location_name into r
    from public.club_membership_join_requests j join public.club_products p on p.id=j.product_id left join public.club_locations l on l.id=j.location_id
    where j.organisation_id=p_organisation_id and j.user_id=auth.uid() order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_method',r.payment_method,
    'payment_provider',r.payment_provider,'product_name',r.product_name,'price_minor',r.price_minor,'currency',r.currency,
    'billing',r.billing,'location_name',r.location_name,'membership_id',r.membership_id,'updated_at',r.updated_at,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state,'paid_through_at',r.paid_through_at);
end; $$;
revoke all on function public.club_get_my_join_state(uuid) from public,anon;
grant execute on function public.club_get_my_join_state(uuid) to authenticated;

create or replace function public.club_retry_join_payment(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.payment_method not in ('card','direct_debit','card_and_direct_debit') or r.status not in ('payment_required','payment_failed','retry_required') then raise exception 'Payment retry is unavailable' using errcode='42501'; end if;
  update public.club_membership_join_requests set status='payment_required',payment_state='unavailable',
    upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'unavailable' end,
    recurring_authority_state=case when recurring_authority_state in ('not_required','confirmed') then recurring_authority_state else 'unavailable' end,
    payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_provider',r.payment_provider,
    'upfront_payment_state',r.upfront_payment_state,'recurring_authority_state',r.recurring_authority_state);
end; $$;
revoke all on function public.club_retry_join_payment(uuid) from public,anon;
grant execute on function public.club_retry_join_payment(uuid) to authenticated;

create or replace function public.club_record_join_provider_event(p_request_id uuid,p_provider_type text,p_provider_event_key text,p_event_type text,p_amount_minor integer,p_provider_reference text,p_occurred_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; existing public.club_membership_join_provider_events%rowtype; v_end timestamptz; v_next timestamptz;
begin
  if nullif(btrim(p_provider_event_key),'') is null or p_event_type not in ('upfront_confirmed','upfront_failed','mandate_confirmed','mandate_failed') then raise exception 'Invalid join provider event' using errcode='22023'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  select * into existing from public.club_membership_join_provider_events where organisation_id=r.organisation_id and provider_type=p_provider_type and provider_event_key=p_provider_event_key;
  if found then return jsonb_build_object('event',to_jsonb(existing),'request',to_jsonb(r)); end if;
  if p_event_type like 'upfront_%' and (p_provider_type<>'stripe' or p_amount_minor is distinct from r.upfront_amount_minor) then raise exception 'Upfront payment does not match the join request' using errcode='22023'; end if;
  if p_event_type like 'mandate_%' and (r.checkout_kind<>'monthly_recurring' or p_provider_type<>'gocardless') then raise exception 'Recurring authority is not required for this join' using errcode='22023'; end if;
  if p_event_type in ('upfront_confirmed','mandate_confirmed') and nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider confirmation reference is required' using errcode='22023'; end if;
  insert into public.club_membership_join_provider_events(organisation_id,join_request_id,provider_type,provider_event_key,event_type,amount_minor,provider_reference,occurred_at)
    values(r.organisation_id,r.id,p_provider_type,p_provider_event_key,p_event_type,p_amount_minor,nullif(btrim(p_provider_reference),''),coalesce(p_occurred_at,now())) returning * into existing;
  if p_event_type='upfront_confirmed' then update public.club_membership_join_requests set upfront_payment_state='confirmed',payment_failure_reason=null,updated_at=now() where id=r.id;
  elsif p_event_type='upfront_failed' then update public.club_membership_join_requests set upfront_payment_state='failed',payment_state='failed',status='payment_failed',payment_failure_reason='Upfront card payment failed',updated_at=now() where id=r.id;
  elsif p_event_type='mandate_confirmed' then update public.club_membership_join_requests set recurring_authority_state='confirmed',recurring_authority_reference=p_provider_reference,payment_failure_reason=null,updated_at=now() where id=r.id;
  else update public.club_membership_join_requests set recurring_authority_state='failed',payment_state='failed',status='payment_failed',payment_failure_reason='Direct Debit mandate setup failed',updated_at=now() where id=r.id; end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') and r.membership_id is null then
    select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
    if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
    v_end:=case when r.checkout_kind='monthly_recurring' then null when p.duration_days is not null then coalesce(p_occurred_at,now())+make_interval(days=>p.duration_days) end;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
      values(r.organisation_id,p.id,'active',coalesce(p_occurred_at,now()),v_end,'purchase','join:'||r.id) returning * into m;
    insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,r.user_id);
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select r.user_id,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source from public.club_product_entitlements e where e.product_id=p.id;
    if r.checkout_kind='monthly_recurring' then
      v_next:=public.club_membership_anniversary(coalesce(p_occurred_at,now()),r.billing_anchor_day,1);
      insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,billing_anchor_day,last_successful_payment_at)
        values(r.organisation_id,m.id,r.user_id,r.customer_id,'gocardless','direct_debit',r.recurring_authority_reference,r.first_period_minor,p.currency,'monthly',v_next,r.billing_anchor_day,coalesce(p_occurred_at,now()));
    end if;
    update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',paid_through_at=v_end,completed_at=now(),last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
    update public.club_member_notification_intents set state='cancelled' where join_request_id=r.id and template_key='join_incomplete';
    if r.checkout_kind='annual_one_off' and v_end is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before) values
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_month','unavailable','annual-renewal-month:'||r.id,v_end-interval '1 month'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_week','unavailable','annual-renewal-week:'||r.id,v_end-interval '7 days'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_final_days','unavailable','annual-renewal-final:'||r.id,v_end-interval '3 days')
      on conflict(organisation_id,idempotency_key) do nothing;
    end if;
  end if;
  return jsonb_build_object('event',to_jsonb(existing),'request',to_jsonb(r),'membership_id',r.membership_id);
end; $$;
revoke all on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) to service_role;

create table if not exists public.user_tutorial_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  tutorial_key text not null check(tutorial_key in ('member_core','madhouse_connected','coach_core')),
  version integer not null check(version>0),
  status text not null check(status in ('completed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,tutorial_key,version)
);
alter table public.user_tutorial_progress enable row level security;
revoke all on table public.user_tutorial_progress from public,anon,authenticated;
grant select on table public.user_tutorial_progress to authenticated;
drop policy if exists user_tutorial_progress_subject_read on public.user_tutorial_progress;
create policy user_tutorial_progress_subject_read on public.user_tutorial_progress for select to authenticated using(user_id=auth.uid());

create or replace function public.r12_get_my_tutorial_context()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'member_ready',exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce(nullif(btrim(p.first_name),''),nullif(btrim(p.display_name),''),nullif(btrim(p.email),'')) is not null),
    'madhouse_connected',exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_organisations o on o.id=m.organisation_id where h.user_id=auth.uid() and o.slug='madhouse-gym'),
    'coach_ready',exists(select 1 from public.coach_permissions cp where cp.user_id=auth.uid() and cp.active),
    'progress',coalesce((select jsonb_agg(jsonb_build_object('tutorial_key',t.tutorial_key,'version',t.version,'status',t.status,'finished_at',t.finished_at)) from public.user_tutorial_progress t where t.user_id=auth.uid()),'[]'::jsonb)
  ) where auth.uid() is not null;
$$;

create or replace function public.r12_save_my_tutorial_progress(p_tutorial_key text,p_version integer,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.user_tutorial_progress%rowtype;
begin
  if auth.uid() is null or p_version<1 or p_status not in ('completed','skipped') or p_tutorial_key not in ('member_core','madhouse_connected','coach_core') then raise exception 'Tutorial progress is invalid' using errcode='22023'; end if;
  if p_tutorial_key='coach_core' and not exists(select 1 from public.coach_permissions where user_id=auth.uid() and active) then raise exception 'Coach tutorial is unavailable' using errcode='42501'; end if;
  if p_tutorial_key='madhouse_connected' and not exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_organisations o on o.id=m.organisation_id where h.user_id=auth.uid() and o.slug='madhouse-gym') then raise exception 'Madhouse introduction is unavailable' using errcode='42501'; end if;
  if p_tutorial_key='member_core' and not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Member tutorial is unavailable' using errcode='42501'; end if;
  insert into public.user_tutorial_progress(user_id,tutorial_key,version,status) values(auth.uid(),p_tutorial_key,p_version,p_status)
  on conflict(user_id,tutorial_key,version) do update set status=excluded.status,finished_at=now(),updated_at=now() returning * into result;
  return to_jsonb(result);
end; $$;
revoke all on function public.r12_get_my_tutorial_context(),public.r12_save_my_tutorial_progress(text,integer,text) from public,anon;
grant execute on function public.r12_get_my_tutorial_context(),public.r12_save_my_tutorial_progress(text,integer,text) to authenticated;

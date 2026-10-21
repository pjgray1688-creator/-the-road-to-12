-- Split Madhouse Stripe processing by legal merchant and keep the gym join
-- product cross-site. This migration only adds reviewed application state; it
-- creates no Stripe resources and changes no existing payments or members.

-- Keep this migration safe on installations that predate the optional Stripe
-- checkout columns on join requests. Declare every column used by later
-- indexes and membership RPCs before creating any of those objects.
alter table public.club_membership_join_requests
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_generation integer not null default 0,
  add column if not exists stripe_event_occurred_at timestamptz,
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
  add column if not exists stripe_dispute_event_at timestamptz,
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text;

alter table public.club_stripe_membership_events
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text;

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

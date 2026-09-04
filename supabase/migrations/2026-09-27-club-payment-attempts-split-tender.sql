-- Provider-neutral payment attempts and safe Madhouse Balance holds.
-- Review-only: execute after 2026-09-25. No external provider is enabled by this migration.

create table if not exists public.club_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  external_method text check (external_method is null or external_method in ('card','klarna','clearpay','paypal','bank_transfer')),
  total_minor integer not null check (total_minor > 0),
  balance_amount_minor integer not null default 0 check (balance_amount_minor >= 0),
  external_amount_minor integer not null default 0 check (external_amount_minor >= 0),
  idempotency_key text not null,
  failure_reason text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict
);

create table if not exists public.club_balance_holds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  account_id uuid not null,
  order_id uuid not null,
  payment_attempt_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  status text not null default 'held' check (status in ('held','captured','released')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  unique (payment_attempt_id, organisation_id),
  foreign key (account_id, organisation_id) references public.club_balance_accounts(id, organisation_id) on delete restrict,
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict,
  foreign key (payment_attempt_id, organisation_id) references public.club_payment_attempts(id, organisation_id) on delete restrict
);

alter table public.club_payment_attempts enable row level security;
alter table public.club_balance_holds enable row level security;
revoke all on table public.club_payment_attempts, public.club_balance_holds from public, anon, authenticated;

create or replace function public.club_create_payment_attempt(
  p_organisation_id uuid, p_order_id uuid, p_balance_amount_minor integer,
  p_external_method text, p_external_amount_minor integer, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_account public.club_balance_accounts%rowtype;
  v_attempt public.club_payment_attempts%rowtype;
  v_hold public.club_balance_holds%rowtype;
  v_available integer;
begin
  if auth.uid() is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Payment attempt is not valid' using errcode='42501';
  end if;
  select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or v_order.status <> 'pending_payment' or v_order.user_id is distinct from auth.uid() then
    raise exception 'Order is not available for payment' using errcode='42501';
  end if;
  if p_balance_amount_minor < 0 or p_external_amount_minor < 0 or p_balance_amount_minor + p_external_amount_minor <> v_order.total_minor then
    raise exception 'Payment amounts do not match order total' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_amount_minor = 0 then
    raise exception 'External payment amount must be positive' using errcode='22023';
  end if;
  if p_external_amount_minor > 0 and p_external_method is null then
    raise exception 'An external payment method is required' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_method not in ('card','klarna','clearpay','paypal','bank_transfer') then
    raise exception 'External payment method is not supported' using errcode='22023';
  end if;
  select * into v_attempt from public.club_payment_attempts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',(select to_jsonb(h) from public.club_balance_holds h where h.payment_attempt_id=v_attempt.id));
  end if;
  -- An order has one active payment attempt at a time. This prevents two external
  -- processors (or two different external methods) being attached concurrently.
  if exists(select 1 from public.club_payment_attempts where organisation_id=p_organisation_id and order_id=p_order_id and status='pending') then
    raise exception 'Another payment attempt is already in progress' using errcode='22023';
  end if;
  if p_balance_amount_minor > 0 then
    select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and user_id=auth.uid() and status='active' for update;
    if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
    v_available := coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0)
      - coalesce((select sum(amount_minor) from public.club_balance_holds where account_id=v_account.id and status='held'),0);
    if v_available < p_balance_amount_minor then raise exception 'Insufficient Madhouse Balance' using errcode='22023'; end if;
  end if;
  insert into public.club_payment_attempts(organisation_id,order_id,user_id,total_minor,balance_amount_minor,external_method,external_amount_minor,idempotency_key)
    values(p_organisation_id,p_order_id,auth.uid(),v_order.total_minor,p_balance_amount_minor,p_external_method,p_external_amount_minor,p_idempotency_key) returning * into v_attempt;
  if p_balance_amount_minor > 0 then
    insert into public.club_balance_holds(organisation_id,account_id,order_id,payment_attempt_id,amount_minor,idempotency_key)
      values(p_organisation_id,v_account.id,p_order_id,v_attempt.id,p_balance_amount_minor,p_idempotency_key) returning * into v_hold;
  end if;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

create or replace function public.club_release_payment_attempt(p_attempt_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_attempt public.club_payment_attempts%rowtype; v_hold public.club_balance_holds%rowtype;
begin
  select * into v_attempt from public.club_payment_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if v_attempt.status='paid' then raise exception 'Paid payment cannot be released' using errcode='22023'; end if;
  update public.club_payment_attempts set status='cancelled',failure_reason=nullif(btrim(p_reason),''),updated_at=now() where id=v_attempt.id returning * into v_attempt;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=v_attempt.id and status='held' returning * into v_hold;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

revoke all on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) from public,anon;
revoke all on function public.club_release_payment_attempt(uuid,text) from public,anon;
grant execute on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) to authenticated;
grant execute on function public.club_release_payment_attempt(uuid,text) to authenticated;

comment on table public.club_payment_attempts is 'Provider-neutral pending payment intents. No provider approval or payment success is implied.';
comment on table public.club_balance_holds is 'Temporary internal Madhouse Balance reservations released on failed/cancelled external payment.';

-- A commerce product may optionally point at the existing Club service model.
-- This keeps service fulfilment on its established transaction ledger.
alter table public.club_commerce_products add column if not exists service_id uuid;
do $$ begin
  alter table public.club_commerce_products add constraint club_commerce_products_service_fk
    foreign key (service_id, organisation_id) references public.club_services(id, organisation_id) on delete restrict;
exception when duplicate_object then null;
end $$;
alter table public.club_service_transactions add column if not exists commerce_order_item_id uuid references public.club_order_items(id) on delete restrict;
create unique index if not exists club_service_transactions_order_item_uq on public.club_service_transactions(commerce_order_item_id) where commerce_order_item_id is not null;

-- Trusted provider-callback boundary. This function is intentionally not executable
-- by browser roles; a future provider adapter must call it from a trusted backend.
create or replace function public.club_capture_payment_attempt(p_attempt_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype; o public.club_orders%rowtype; account public.club_balance_accounts%rowtype; entry public.club_balance_entries%rowtype; item public.club_order_items%rowtype; product public.club_commerce_products%rowtype; balance integer; method text; customer uuid;
begin
  if nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider reference is required' using errcode='22023'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then return jsonb_build_object('status','paid','attempt',to_jsonb(a)); end if;
  if a.status in ('failed','cancelled') or a.external_amount_minor<=0 or a.external_method is null then raise exception 'Payment attempt cannot be captured' using errcode='22023'; end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found or o.status<>'pending_payment' then raise exception 'Order is not payable' using errcode='22023'; end if;
  select * into h from public.club_balance_holds where payment_attempt_id=a.id and organisation_id=a.organisation_id for update;
  if h.id is not null and h.status<>'held' then raise exception 'Balance hold is not available' using errcode='22023'; end if;
  if h.id is not null then
    select * into account from public.club_balance_accounts where id=h.account_id and organisation_id=a.organisation_id for update;
    balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=account.id),0);
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,idempotency_key,reason)
      values(account.id,a.organisation_id,'purchase',-h.amount_minor,balance-h.amount_minor,o.id,a.id::text||':balance','Split payment Balance capture') returning * into entry;
    update public.club_balance_holds set status='captured',updated_at=now() where id=h.id;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
      values(o.id,a.organisation_id,'balance',a.id::text||':balance',h.amount_minor,o.currency,'paid',jsonb_build_object('payment_attempt_id',a.id,'tender','madhouse_balance'));
  end if;
  method:=case when a.external_method='card' then 'card' else 'other' end;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
    values(o.id,a.organisation_id,method,p_provider_reference,a.external_amount_minor,o.currency,'paid',jsonb_build_object('provider',a.external_method,'payment_attempt_id',a.id,'tender','external'));
  update public.club_payment_attempts set status='paid',provider_reference=p_provider_reference,updated_at=now() where id=a.id returning * into a;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  for item in select * from public.club_order_items where order_id=o.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(o.organisation_id,o.location_id,item.product_id,'sale',-item.quantity,o.id,null,a.id::text||':stock:'||item.id) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  -- Supplier demand is generated by the paid-payment trigger. Call it explicitly
  -- as well so the trusted capture boundary remains correct if trigger deployment
  -- is staged; the order-item unique index makes this idempotent.
  perform public.club_create_supplier_demand_for_order(o.id);
  for item in select * from public.club_order_items where order_id=o.id loop
    select * into product from public.club_commerce_products where id=item.product_id and organisation_id=o.organisation_id;
    if product.service_id is not null then
      if o.location_id is null then raise exception 'Service order requires a location' using errcode='22023'; end if;
      customer:=o.customer_id;
      if customer is null and o.user_id is not null then select id into customer from public.club_customers where organisation_id=o.organisation_id and user_id=o.user_id limit 1; end if;
      insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata)
        values(o.organisation_id,o.location_id,product.service_id,customer,item.quantity,item.unit_price_minor,o.currency,'paid',method,a.id::text,'fulfilled',item.id,jsonb_build_object('order_id',o.id,'payment_attempt_id',a.id))
        on conflict (commerce_order_item_id) do nothing;
    end if;
  end loop;
  return jsonb_build_object('status','paid','attempt',to_jsonb(a),'balance_entry',case when entry.id is null then null else to_jsonb(entry) end);
end; $$;
revoke all on function public.club_capture_payment_attempt(uuid,text) from public,anon,authenticated;
-- Supabase's trusted service role is the only executable provider-callback route.
grant execute on function public.club_capture_payment_attempt(uuid,text) to service_role;

create or replace function public.club_fail_payment_attempt(p_attempt_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype;
begin
  select * into a from public.club_payment_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then raise exception 'Paid payment cannot fail' using errcode='22023'; end if;
  if a.status='failed' then return jsonb_build_object('attempt',to_jsonb(a)); end if;
  update public.club_payment_attempts set status='failed',failure_reason=nullif(btrim(p_reason),''),updated_at=now() where id=a.id returning * into a;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=a.id and status='held' returning * into h;
  return jsonb_build_object('attempt',to_jsonb(a),'hold',case when h.id is null then null else to_jsonb(h) end);
end; $$;
revoke all on function public.club_fail_payment_attempt(uuid,text) from public,anon;
grant execute on function public.club_fail_payment_attempt(uuid,text) to authenticated;

-- Read-only member recovery state; identity is derived from auth.uid().
create or replace function public.club_get_payment_attempt(p_attempt_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('attempt',to_jsonb(a),'hold',(select to_jsonb(h) from public.club_balance_holds h where h.payment_attempt_id=a.id))
from public.club_payment_attempts a where a.id=p_attempt_id and a.user_id=auth.uid();
$$;
revoke all on function public.club_get_payment_attempt(uuid) from public,anon;
grant execute on function public.club_get_payment_attempt(uuid) to authenticated;

-- Shared paid-order finalisation. Every successful tender path must call this
-- primitive after marking the order paid. Its idempotency keys and the
-- commerce-order-item unique service index make retries safe.
create or replace function public.club_finalize_paid_order(p_order_id uuid, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_item public.club_order_items%rowtype;
  v_product public.club_commerce_products%rowtype;
  v_customer uuid;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or v_order.status <> 'paid' then
    raise exception 'Paid order is required for finalisation' using errcode='22023';
  end if;
  for v_item in select * from public.club_order_items where order_id=v_order.id order by id loop
    if v_item.stock_tracked then
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,p_actor_user_id,'order-finalise:'||v_item.id::text)
      on conflict (organisation_id,idempotency_key) do nothing;
    end if;
    select * into v_product from public.club_commerce_products where id=v_item.product_id and organisation_id=v_order.organisation_id;
    if v_product.service_id is not null then
      if v_order.location_id is null then raise exception 'Service order requires a location' using errcode='22023'; end if;
      v_customer:=v_order.customer_id;
      if v_customer is null and v_order.user_id is not null then
        select id into v_customer from public.club_customers where organisation_id=v_order.organisation_id and user_id=v_order.user_id limit 1;
      end if;
      insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata)
      values(v_order.organisation_id,v_order.location_id,v_product.service_id,v_customer,p_actor_user_id,v_item.quantity,v_item.unit_price_minor,v_order.currency,'paid','commerce',v_order.id::text,'pending',v_item.id,jsonb_build_object('commerce_order_id',v_order.id))
      on conflict (commerce_order_item_id) do nothing;
    end if;
  end loop;
  perform public.club_create_supplier_demand_for_order(v_order.id);
end; $$;
revoke all on function public.club_finalize_paid_order(uuid,uuid) from public,anon,authenticated;

-- Final provider capture delegates all fulfilment effects to the shared
-- primitive. It remains callable only by the trusted service role.
create or replace function public.club_capture_payment_attempt(p_attempt_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype; o public.club_orders%rowtype; account public.club_balance_accounts%rowtype; entry public.club_balance_entries%rowtype; method text;
begin
  if nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider reference is required' using errcode='22023'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then return jsonb_build_object('status','paid','attempt',to_jsonb(a)); end if;
  if a.status in ('failed','cancelled') or a.external_amount_minor<=0 or a.external_method is null then raise exception 'Payment attempt cannot be captured' using errcode='22023'; end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found or o.status<>'pending_payment' then raise exception 'Order is not payable' using errcode='22023'; end if;
  select * into h from public.club_balance_holds where payment_attempt_id=a.id and organisation_id=a.organisation_id for update;
  if h.id is not null then
    if h.status<>'held' then raise exception 'Balance hold is not available' using errcode='22023'; end if;
    select * into account from public.club_balance_accounts where id=h.account_id and organisation_id=a.organisation_id for update;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,idempotency_key,reason)
    values(account.id,a.organisation_id,'purchase',-h.amount_minor,coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=account.id),0)-h.amount_minor,o.id,a.id::text||':balance','Split payment Balance capture') returning * into entry;
    update public.club_balance_holds set status='captured',updated_at=now() where id=h.id;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
    values(o.id,a.organisation_id,'balance',a.id::text||':balance',h.amount_minor,o.currency,'paid',jsonb_build_object('payment_attempt_id',a.id,'tender','madhouse_balance'));
  end if;
  method:=case when a.external_method='card' then 'card' else 'other' end;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
  values(o.id,a.organisation_id,method,p_provider_reference,a.external_amount_minor,o.currency,'paid',jsonb_build_object('provider',a.external_method,'payment_attempt_id',a.id,'tender','external'));
  update public.club_payment_attempts set status='paid',provider_reference=p_provider_reference,updated_at=now() where id=a.id returning * into a;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,null);
  return jsonb_build_object('status','paid','attempt',to_jsonb(a),'balance_entry',case when entry.id is null then null else to_jsonb(entry) end);
end; $$;
revoke all on function public.club_capture_payment_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.club_capture_payment_attempt(uuid,text) to service_role;

-- Cash verification is also a paid-order boundary; retain the declaration
-- safety checks while routing confirmed orders through shared finalisation.
create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update;
  if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<> 'declared' then if v_row.status=p_status then return to_jsonb(v_row); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if v_row.purpose='commerce_order' then
    select * into v_order from public.club_orders where id=v_row.order_id and organisation_id=v_row.organisation_id for update;
    if p_status='confirmed' then
      if not found or v_order.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
      insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(v_order.id,v_order.organisation_id,'cash',v_order.total_minor,v_order.currency,'paid',coalesce(v_row.idempotency_key,v_row.id::text)) on conflict do nothing;
      update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
      perform public.club_finalize_paid_order(v_order.id,auth.uid());
    elsif found and v_order.status='awaiting_cash_verification' then update public.club_orders set status='cash_disputed',updated_at=now() where id=v_order.id; end if;
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

-- Existing direct settlement RPCs use the same finalisation boundary.
create or replace function public.club_record_cash_payment(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; p public.club_payments%rowtype; existing public.club_payments%rowtype;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(o.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash settlement is not permitted' using errcode='42501'; end if;
  if o.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  if p_amount_minor<>o.total_minor or p_amount_minor<0 or o.status<>'pending_payment' then raise exception 'Order is not eligible for cash settlement' using errcode='22023'; end if;
  select * into existing from public.club_payments where organisation_id=o.organisation_id and external_reference=p_idempotency_key and order_id=o.id;
  if found then return to_jsonb(existing); end if;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'cash',p_idempotency_key,p_amount_minor,o.currency,'paid') returning * into p;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(p);
end; $$;

create or replace function public.club_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; prior public.club_balance_entries%rowtype; b integer;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or o.user_id is distinct from auth.uid() then raise exception 'Balance spend is not permitted' using errcode='42501'; end if;
  if o.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  select * into a from public.club_balance_accounts where organisation_id=o.organisation_id and user_id=auth.uid() for update;
  if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into prior from public.club_balance_entries where organisation_id=o.organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(prior); end if;
  if p_amount_minor<=0 or p_amount_minor<>o.total_minor or o.status<>'pending_payment' then raise exception 'Balance settlement is not eligible' using errcode='22023'; end if;
  b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0);
  if b<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(a.id,o.organisation_id,'purchase',-p_amount_minor,b-p_amount_minor,o.id,auth.uid(),p_idempotency_key) returning * into e;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'balance',p_idempotency_key,p_amount_minor,o.currency,'paid');
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(e);
end; $$;

create or replace function public.club_staff_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; prior public.club_balance_entries%rowtype; b integer;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or not public.club_capability_allowed(o.organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Balance sale is not permitted' using errcode='42501'; end if;
  if o.customer_id is null or o.status<>'pending_payment' or p_amount_minor<>o.total_minor or p_amount_minor<=0 then raise exception 'Order is not eligible for balance payment' using errcode='22023'; end if;
  select * into a from public.club_balance_accounts where organisation_id=o.organisation_id and customer_id=o.customer_id for update;
  if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into prior from public.club_balance_entries where organisation_id=o.organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(prior); end if;
  b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0); if b<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(a.id,o.organisation_id,'purchase',-p_amount_minor,b-p_amount_minor,o.id,auth.uid(),p_idempotency_key) returning * into e;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'balance',p_idempotency_key,p_amount_minor,o.currency,'paid');
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(e);
end; $$;

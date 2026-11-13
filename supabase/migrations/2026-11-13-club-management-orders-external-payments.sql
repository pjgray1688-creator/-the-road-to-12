begin;

-- Management order/payment extension over the existing shared commerce ledger.
-- It does not create a parallel order or payment store and does not call a
-- payment provider. All external receipts remain Products & Services income.
do $$
begin
  if to_regclass('public.club_orders') is null
    or to_regclass('public.club_order_items') is null
    or to_regclass('public.club_payments') is null
    or to_regclass('public.club_customers') is null
    or to_regclass('public.club_commerce_products') is null
    or to_regclass('public.club_payment_accounts') is null
    or to_regclass('public.club_payment_attempts') is null
    or to_regclass('public.club_locations') is null
    or to_regclass('public.club_members') is null
    or to_regclass('public.club_audit_events') is null
    or to_regprocedure('public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text)') is null
    or to_regprocedure('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)') is null
    or to_regprocedure('public.club_apply_order_discount(uuid,uuid,text,integer,numeric,text,text)') is null
    or to_regprocedure('public.club_reserve_order_stock(uuid)') is null
    or to_regprocedure('public.club_release_order_reservations(uuid,text)') is null
    or to_regprocedure('public.club_finalize_paid_order(uuid,uuid)') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
    or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
    or to_regprocedure('public.club_has_active_role(uuid,text[])') is null
    or to_regprocedure('public.club_create_customer(uuid,uuid,text,text,text,text)') is null
  then
    raise exception 'Management-order prerequisites are missing; no application objects were changed';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_orders' and column_name in ('id','organisation_id','location_id','customer_id','status','currency','subtotal_minor','discount_minor','total_minor','created_by','idempotency_key') group by table_name having count(*)=11)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_payments' and column_name in ('id','order_id','organisation_id','payment_account_id','method','external_reference','amount_minor','currency','status','created_at','updated_at') group by table_name having count(*)=11)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name in ('organisation_id','actor_user_id','actor_role','action','target_type','target_id','location_id','reason','metadata') group by table_name having count(*)=9)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_commerce_products' and column_name in ('id','organisation_id','active','name','sku','category','sell_price_minor','currency','stock_tracked','service_credit_quantity') group by table_name having count(*)=10)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_payment_accounts' and column_name in ('id','organisation_id','provider','purpose','external_account_reference','status') group by table_name having count(*)=6)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_payment_attempts' and column_name in ('organisation_id','order_id','status') group by table_name having count(*)=3)
  then
    raise exception 'Management-order prerequisite columns are missing; no application objects were changed';
  end if;
end $$;

alter table public.club_payments
  add column if not exists idempotency_key text,
  add column if not exists external_method text,
  add column if not exists received_at timestamptz,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_status text,
  add column if not exists receiving_account_label text,
  add column if not exists merchant_entity text,
  add column if not exists processor_fee_minor integer,
  add column if not exists settlement_amount_minor integer;

do $$ begin
  alter table public.club_payments add constraint club_payments_management_external_method_ck
    check (external_method is null or external_method in ('cash','bank_transfer','paypal','paypal_pay_in_3_settlement','external_card_terminal','other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.club_payments add constraint club_payments_management_verification_ck
    check (verification_status is null or verification_status in ('awaiting_verification','confirmed','rejected','refunded','reversed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.club_payments add constraint club_payments_management_merchant_ck
    check (merchant_entity is null or merchant_entity='madhouse_products_services');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.club_payments add constraint club_payments_management_account_label_ck
    check (receiving_account_label is null or length(btrim(receiving_account_label)) between 1 and 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.club_payments add constraint club_payments_management_settlement_ck
    check ((processor_fee_minor is null and settlement_amount_minor is null) or (processor_fee_minor is not null and settlement_amount_minor is not null and processor_fee_minor>=0 and settlement_amount_minor>=0 and settlement_amount_minor=amount_minor-processor_fee_minor));
exception when duplicate_object then null; end $$;

create unique index if not exists club_payments_management_idempotency_uq
  on public.club_payments(organisation_id,idempotency_key) where idempotency_key is not null;
create index if not exists club_payments_management_order_status_idx
  on public.club_payments(organisation_id,order_id,status,created_at);
create or replace function public.club_management_create_order_secure(
  p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_items jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_customer public.club_customers%rowtype;
  v_result jsonb;
  v_order_id uuid;
  v_replayed boolean;
  v_pricing jsonb;
  v_discount integer;
  v_promotion_names text;
  v_order public.club_orders%rowtype;
  v_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Management order access is not permitted' using errcode='42501';
  end if;
  if p_location_id is null or p_customer_id is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50
    or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120 then
    raise exception 'Management order input is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active)
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Order location is outside the organisation' using errcode='42501';
  end if;
  select * into v_customer from public.club_customers c where c.id=p_customer_id and c.organisation_id=p_organisation_id;
  if not found then raise exception 'Order customer is outside the organisation' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where coalesce((i->>'quantity')::integer,0)<1 or coalesce((i->>'quantity')::integer,0)>50) then
    raise exception 'Order quantity is invalid' using errcode='22023';
  end if;

  v_result:=public.club_create_commerce_order(p_organisation_id,p_location_id,p_customer_id,'staff_checkout','GBP',p_items,p_idempotency_key);
  v_order_id:=(v_result->'order'->>'id')::uuid;
  v_replayed:=coalesce((v_result->>'replayed')::boolean,false);
  if not v_replayed then
    select * into v_order from public.club_orders where id=v_order_id and organisation_id=p_organisation_id for update;
    if v_order.total_minor<=0 then raise exception 'Zero-value orders require the established complimentary-order workflow' using errcode='22023'; end if;
    v_pricing:=public.club_evaluate_commerce_promotions(p_organisation_id,p_location_id,v_customer.user_id,p_customer_id,p_items,null);
    v_discount:=coalesce((v_pricing->>'discount_minor')::integer,0);
    if v_discount>0 then
      if not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
        raise exception 'Applying the active promotion requires product-pricing permission' using errcode='42501';
      end if;
      select string_agg(coalesce(x->>'promotion_name','active offer'),', ' order by n)
        into v_promotion_names from jsonb_array_elements(coalesce(v_pricing->'applied','[]'::jsonb)) with ordinality a(x,n);
      if v_discount>=coalesce((v_pricing->>'gross_minor')::integer,0) then
        raise exception 'A fully discounted order requires the established complimentary-order workflow' using errcode='22023';
      end if;
      perform public.club_apply_order_discount(p_organisation_id,v_order_id,'fixed',v_discount,null,
        'Authoritative active offer: '||left(coalesce(v_promotion_names,'active commerce promotion'),180),p_idempotency_key||':promotion');
    end if;
    update public.club_orders set status='draft',updated_at=now() where id=v_order_id and organisation_id=p_organisation_id;
    select * into v_order from public.club_orders where id=v_order_id and organisation_id=p_organisation_id for update;
    select m.role into v_role from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active limit 1;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
      values(p_organisation_id,auth.uid(),v_role,'commerce.management_order_draft_created','order',v_order_id,p_location_id,
        jsonb_build_object('customer_id',p_customer_id,'item_count',jsonb_array_length(p_items),'total_minor',v_order.total_minor,'promotion_discount_minor',v_order.discount_minor));
  else
    select * into v_order from public.club_orders where id=v_order_id and organisation_id=p_organisation_id;
  end if;
  return jsonb_build_object('order',jsonb_build_object('id',v_order.id,'organisation_id',v_order.organisation_id,'location_id',v_order.location_id,'customer_id',v_order.customer_id,'status',v_order.status,'currency',v_order.currency,'subtotal_minor',v_order.subtotal_minor,'discount_minor',v_order.discount_minor,'total_minor',v_order.total_minor,'created_at',v_order.created_at),'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'product_name',i.product_name,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor) order by i.created_at) from public.club_order_items i where i.order_id=v_order_id and i.organisation_id=p_organisation_id),'[]'::jsonb),'replayed',v_replayed);
end $$;

create or replace function public.club_management_confirm_order_secure(p_organisation_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_reserved jsonb; v_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then raise exception 'Order confirmation is not permitted' using errcode='42501'; end if;
  select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or v_order.location_id is null or not public.club_location_authorized(p_organisation_id,v_order.location_id) then raise exception 'Order is outside authorised scope' using errcode='42501'; end if;
  if v_order.status='pending_payment' then return jsonb_build_object('order_id',v_order.id,'status',v_order.status,'replayed',true); end if;
  if v_order.status<>'draft' then raise exception 'Order is not a draft' using errcode='22023'; end if;
  v_reserved:=public.club_reserve_order_stock(v_order.id);
  update public.club_orders set status='pending_payment',updated_at=now() where id=v_order.id and organisation_id=p_organisation_id returning * into v_order;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
    values(p_organisation_id,auth.uid(),v_role,'commerce.management_order_confirmed','order',v_order.id,v_order.location_id,jsonb_build_object('total_minor',v_order.total_minor));
  return jsonb_build_object('order_id',v_order.id,'status',v_order.status,'replayed',false,'stock',v_reserved);
end $$;

create or replace function public.club_management_record_order_payment_secure(
  p_organisation_id uuid,p_order_id uuid,p_amount_minor integer,p_method text,p_received_at timestamptz,
  p_receiving_account_label text,p_external_reference text,p_payment_account_id uuid,p_processor_fee_minor integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_payment public.club_payments%rowtype;
  v_existing public.club_payments%rowtype;
  v_reserved integer;
  v_paid integer;
  v_table_method text;
  v_verification text;
  v_role text;
  v_account public.club_payment_accounts%rowtype;
  v_receiving_label text;
  v_location_name text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'External order payment access is not permitted' using errcode='42501';
  end if;
  if p_amount_minor<=0 or p_processor_fee_minor is null or p_processor_fee_minor<0 or p_processor_fee_minor>p_amount_minor or p_method not in ('cash','bank_transfer','paypal','paypal_pay_in_3_settlement','external_card_terminal','other')
    or p_method is null or p_received_at is null or p_received_at>now()+interval '1 day'
    or length(coalesce(p_receiving_account_label,''))>120
    or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120
    or p_external_reference is not null and length(p_external_reference)>200 then
    raise exception 'External payment details are invalid' using errcode='22023';
  end if;
  select * into v_order from public.club_orders o where o.id=p_order_id and o.organisation_id=p_organisation_id for update;
  if not found or v_order.status<>'pending_payment' then raise exception 'Confirm the order before recording payment' using errcode='22023'; end if;
  select * into v_existing from public.club_payments p where p.organisation_id=p_organisation_id and p.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.amount_minor<>p_amount_minor or v_existing.external_method<>p_method or v_existing.payment_account_id is distinct from p_payment_account_id or v_existing.processor_fee_minor<>p_processor_fee_minor or v_existing.external_reference is distinct from nullif(btrim(p_external_reference),'') then
      raise exception 'Payment idempotency key conflicts with the existing allocation' using errcode='23505';
    end if;
    return jsonb_build_object('payment',jsonb_build_object('id',v_existing.id,'order_id',v_existing.order_id,'amount_minor',v_existing.amount_minor,'method',v_existing.method,'external_method',v_existing.external_method,'status',v_existing.status,'verification_status',v_existing.verification_status),'replayed',true);
  end if;
  if p_method='cash' then
    if p_payment_account_id is not null or p_processor_fee_minor<>0 then raise exception 'Cash cannot include an electronic account or processor fee' using errcode='22023'; end if;
    select name into v_location_name from public.club_locations where id=v_order.location_id and organisation_id=p_organisation_id and active;
    if v_location_name is null then raise exception 'Cash receipt venue is unavailable' using errcode='22023'; end if;
    v_receiving_label:='Cash received · '||v_location_name;
  else
    select * into v_account from public.club_payment_accounts a where a.id=p_payment_account_id and a.organisation_id=p_organisation_id and a.status in ('connected','active') and a.purpose='madhouse_products_services';
    if not found then raise exception 'Select an active Products & Services receiving account' using errcode='22023'; end if;
    if (p_method in ('paypal','paypal_pay_in_3_settlement') and lower(v_account.provider)<>'paypal')
       or (p_method='bank_transfer' and lower(v_account.provider) not in ('bank','bank_transfer'))
       or (p_method='external_card_terminal' and lower(v_account.provider) not in ('external_card_terminal','card_terminal')) then
      raise exception 'Payment method does not match the receiving account provider' using errcode='22023';
    end if;
    v_receiving_label:=left(v_account.provider||case when nullif(btrim(v_account.external_account_reference),'') is null then '' else ' · '||btrim(v_account.external_account_reference) end,120);
  end if;
  if exists(select 1 from public.club_payment_attempts a where a.organisation_id=p_organisation_id and a.order_id=p_order_id and a.status='pending') then
    raise exception 'An integrated payment attempt is already in progress for this order' using errcode='22023';
  end if;
  select coalesce(sum(p.amount_minor),0)::integer into v_reserved from public.club_payments p
    where p.organisation_id=p_organisation_id and p.order_id=p_order_id and p.status in ('paid','pending');
  if p_amount_minor>v_order.total_minor-v_reserved then raise exception 'Payment exceeds the order amount still available' using errcode='22023'; end if;
  v_table_method:=case when p_method in ('cash','bank_transfer') then p_method else 'other' end;
  v_verification:=case when p_method='cash' then 'confirmed' else 'awaiting_verification' end;
  insert into public.club_payments(order_id,organisation_id,payment_account_id,method,external_reference,amount_minor,currency,status,
      idempotency_key,external_method,received_at,recorded_by,verified_by,verified_at,verification_status,receiving_account_label,merchant_entity,processor_fee_minor,settlement_amount_minor)
    values(p_order_id,p_organisation_id,p_payment_account_id,v_table_method,nullif(btrim(p_external_reference),''),p_amount_minor,v_order.currency,
      case when p_method='cash' then 'paid' else 'pending' end,p_idempotency_key,p_method,p_received_at,auth.uid(),
      case when p_method='cash' then auth.uid() else null end,case when p_method='cash' then now() else null end,v_verification,
      v_receiving_label,'madhouse_products_services',p_processor_fee_minor,p_amount_minor-p_processor_fee_minor) returning * into v_payment;
  if p_method='cash' then
    select coalesce(sum(p.amount_minor),0)::integer into v_paid from public.club_payments p where p.organisation_id=p_organisation_id and p.order_id=p_order_id and p.status='paid';
    if v_paid=v_order.total_minor then
      update public.club_orders set status='paid',updated_at=now() where id=p_order_id and organisation_id=p_organisation_id;
      perform public.club_finalize_paid_order(p_order_id,auth.uid());
    end if;
  end if;
  select m.role into v_role from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
    values(p_organisation_id,auth.uid(),v_role,'finance.external_order_payment_recorded','payment',v_payment.id,v_order.location_id,
      jsonb_build_object('order_id',p_order_id,'amount_minor',p_amount_minor,'method',p_method,'verification_status',v_verification,'merchant_entity','madhouse_products_services'));
  return jsonb_build_object('payment',jsonb_build_object('id',v_payment.id,'order_id',v_payment.order_id,'amount_minor',v_payment.amount_minor,'method',v_payment.method,'external_method',v_payment.external_method,'status',v_payment.status,'verification_status',v_payment.verification_status),'replayed',false);
end $$;

create or replace function public.club_management_verify_order_payment_secure(
  p_organisation_id uuid,p_payment_id uuid,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_payment public.club_payments%rowtype;
  v_order public.club_orders%rowtype;
  v_paid integer;
  v_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Payment verification is not permitted' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('confirmed','rejected') or p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>240 then
    raise exception 'Payment verification decision is invalid' using errcode='22023';
  end if;
  select * into v_payment from public.club_payments p where p.id=p_payment_id and p.organisation_id=p_organisation_id;
  if not found then raise exception 'Payment not found in organisation' using errcode='P0002'; end if;
  select * into v_order from public.club_orders o where o.id=v_payment.order_id and o.organisation_id=p_organisation_id for update;
  if not found then raise exception 'Payment order not found in organisation' using errcode='P0002'; end if;
  select * into v_payment from public.club_payments p where p.id=p_payment_id and p.organisation_id=p_organisation_id for update;
  if v_payment.verification_status in ('confirmed','rejected') then
    if v_payment.verification_status=p_decision then return jsonb_build_object('payment_id',v_payment.id,'verification_status',v_payment.verification_status,'order_status',v_order.status,'replayed',true); end if;
    raise exception 'Payment has already received a different verification decision' using errcode='23505';
  end if;
  if v_payment.verification_status<>'awaiting_verification' or v_payment.status<>'pending' then
    raise exception 'Payment is not awaiting verification' using errcode='22023';
  end if;
  if p_decision='confirmed' then
    select coalesce(sum(p.amount_minor),0)::integer into v_paid from public.club_payments p
      where p.organisation_id=p_organisation_id and p.order_id=v_order.id and p.status='paid';
    if v_paid+v_payment.amount_minor>v_order.total_minor then raise exception 'Confirmed receipts would exceed the order total' using errcode='22023'; end if;
    update public.club_payments set status='paid',verification_status='confirmed',verified_by=auth.uid(),verified_at=now(),updated_at=now() where id=v_payment.id returning * into v_payment;
    v_paid:=v_paid+v_payment.amount_minor;
    if v_paid=v_order.total_minor then
      update public.club_orders set status='paid',updated_at=now() where id=v_order.id and organisation_id=p_organisation_id;
      perform public.club_finalize_paid_order(v_order.id,auth.uid());
      v_order.status:='paid';
    end if;
  else
    update public.club_payments set status='failed',verification_status='rejected',verified_by=auth.uid(),verified_at=now(),updated_at=now() where id=v_payment.id returning * into v_payment;
  end if;
  select m.role into v_role from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
    values(p_organisation_id,auth.uid(),v_role,'finance.external_order_payment_'||p_decision,'payment',v_payment.id,v_order.location_id,btrim(p_reason),jsonb_build_object('order_id',v_order.id,'amount_minor',v_payment.amount_minor,'method',v_payment.external_method));
  return jsonb_build_object('payment_id',v_payment.id,'verification_status',v_payment.verification_status,'order_status',v_order.status,'replayed',false);
end $$;

create or replace function public.club_management_cancel_order_secure(p_organisation_id uuid,p_order_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Order cancellation is not permitted' using errcode='42501';
  end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason)>240 then raise exception 'Cancellation reason is required' using errcode='22023'; end if;
  select * into v_order from public.club_orders o where o.id=p_order_id and o.organisation_id=p_organisation_id for update;
  if not found or v_order.location_id is null or not public.club_location_authorized(p_organisation_id,v_order.location_id) then raise exception 'Order is outside authorised scope' using errcode='42501'; end if;
  if v_order.status not in ('draft','pending_payment')
     or exists(select 1 from public.club_payments p where p.organisation_id=p_organisation_id and p.order_id=p_order_id and p.status in ('paid','pending'))
     or exists(select 1 from public.club_payment_attempts a where a.organisation_id=p_organisation_id and a.order_id=p_order_id and a.status='pending') then
    raise exception 'Order has a receipt or active checkout and cannot be cancelled here' using errcode='22023';
  end if;
  update public.club_orders set status='cancelled',updated_at=now() where id=p_order_id and organisation_id=p_organisation_id;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason)
    values(p_organisation_id,auth.uid(),v_role,'commerce.management_order_cancelled','order',p_order_id,v_order.location_id,left(btrim(p_reason),240));
  return jsonb_build_object('order_id',p_order_id,'status','cancelled');
end $$;

create or replace function public.club_management_list_orders_secure(
  p_organisation_id uuid,p_search text default null,p_status text default null,p_location_id uuid default null,p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Order management access is not permitted' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('draft','pending_payment','partially_paid','paid','fulfilled','cancelled','refunded') then raise exception 'Order status filter is invalid' using errcode='22023'; end if;
  if p_location_id is not null and (not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id) or not public.club_location_authorized(p_organisation_id,p_location_id)) then raise exception 'Order location is outside authorised scope' using errcode='42501'; end if;
  select coalesce(jsonb_agg(q.item order by q.created_at desc),'[]'::jsonb) into v_rows from (
    select o.created_at,jsonb_build_object(
      'id',o.id,'reference',left(o.id::text,8),'organisation_id',o.organisation_id,'location_id',o.location_id,
      'location_name',l.name,'customer_id',o.customer_id,'customer_name',c.display_name,'customer_email',c.email,
      'status',o.status,'financial_status',case when o.status in ('cancelled','refunded','fulfilled') then o.status when o.total_minor>0 and coalesce(p.confirmed_minor,0)>=o.total_minor then 'paid' when coalesce(p.confirmed_minor,0)>0 then 'partially_paid' else o.status end,
      'currency',o.currency,'subtotal_minor',o.subtotal_minor,'discount_minor',o.discount_minor,'total_minor',o.total_minor,
      'confirmed_minor',coalesce(p.confirmed_minor,0),'reserved_minor',coalesce(p.reserved_minor,0),
      'outstanding_minor',greatest(0,o.total_minor-coalesce(p.confirmed_minor,0)),
      'created_at',o.created_at,'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor) order by i.created_at) from public.club_order_items i where i.order_id=o.id and i.organisation_id=p_organisation_id),'[]'::jsonb),
      'payments',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'amount_minor',x.amount_minor,'processor_fee_minor',x.processor_fee_minor,'settlement_amount_minor',x.settlement_amount_minor,'payment_account_id',x.payment_account_id,'currency',x.currency,'method',x.method,'external_method',x.external_method,'external_reference',x.external_reference,'receiving_account_label',x.receiving_account_label,'received_at',x.received_at,'status',x.status,'verification_status',x.verification_status,'recorded_by',x.recorded_by,'verified_by',x.verified_by,'verified_at',x.verified_at,'merchant_entity',x.merchant_entity) order by x.created_at) from public.club_payments x where x.order_id=o.id and x.organisation_id=p_organisation_id),'[]'::jsonb)
    ) as item
    from public.club_orders o
    left join public.club_customers c on c.id=o.customer_id and c.organisation_id=o.organisation_id
    left join public.club_locations l on l.id=o.location_id and l.organisation_id=o.organisation_id
    left join lateral (select sum(x.amount_minor) filter(where x.status='paid')::integer as confirmed_minor,sum(x.amount_minor) filter(where x.status='pending')::integer as reserved_minor from public.club_payments x where x.order_id=o.id and x.organisation_id=o.organisation_id) p on true
    where o.organisation_id=p_organisation_id and (p_location_id is null or o.location_id=p_location_id)
      and (public.club_location_authorized(p_organisation_id,o.location_id) or public.club_has_active_role(p_organisation_id,array['owner','gym_admin']))
      and (p_status is null or o.status=p_status or (p_status='partially_paid' and p.confirmed_minor>0 and p.confirmed_minor<o.total_minor))
      and (nullif(btrim(p_search),'') is null or o.id::text ilike '%'||btrim(p_search)||'%' or c.display_name ilike '%'||btrim(p_search)||'%' or c.email ilike '%'||btrim(p_search)||'%')
    order by o.created_at desc limit greatest(1,least(coalesce(p_limit,100),250))
  ) q;
  return v_rows;
end $$;

create or replace function public.club_management_search_order_products_secure(
  p_organisation_id uuid,p_search text,p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Management order product search is not permitted' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_search,'')))<2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'category',p.category,
    'price_minor',p.sell_price_minor,'currency',p.currency,'stock_tracked',p.stock_tracked,
    'service_credit_quantity',p.service_credit_quantity) order by p.name),'[]'::jsonb)
    into v_rows from public.club_commerce_products p where p.organisation_id=p_organisation_id and p.active
      and (p.name ilike '%'||left(btrim(p_search),80)||'%' or p.sku ilike '%'||left(btrim(p_search),80)||'%' or p.category ilike '%'||left(btrim(p_search),80)||'%')
    order by p.name limit greatest(1,least(coalesce(p_limit,30),50));
  return v_rows;
end $$;

create or replace function public.club_management_list_payment_accounts_secure(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Payment account access is not permitted' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'provider',a.provider,'purpose',a.purpose,'external_account_reference',a.external_account_reference,'status',a.status) order by a.provider,a.external_account_reference),'[]'::jsonb)
    into v_rows from public.club_payment_accounts a where a.organisation_id=p_organisation_id and a.status in ('connected','active') and a.purpose='madhouse_products_services';
  return v_rows;
end $$;

create or replace function public.club_management_configure_payment_account_secure(p_organisation_id uuid,p_provider text,p_external_account_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_account public.club_payment_accounts%rowtype; v_role text; v_ref text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then raise exception 'Payment-account configuration is not permitted' using errcode='42501'; end if;
  v_ref:=nullif(btrim(p_external_account_reference),'');
  if p_provider not in ('bank_transfer','paypal','external_card_terminal','other') or length(coalesce(v_ref,''))>120 then raise exception 'Payment-account details are invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse_products_services:'||p_provider||':'||coalesce(v_ref,''),0));
  select * into v_account from public.club_payment_accounts a where a.organisation_id=p_organisation_id and a.provider=p_provider and a.purpose='madhouse_products_services' and coalesce(a.external_account_reference,'')=coalesce(v_ref,'') for update;
  if not found then
    insert into public.club_payment_accounts(organisation_id,provider,purpose,capabilities,external_account_reference,status)
      values(p_organisation_id,p_provider,'madhouse_products_services',array[p_provider],v_ref,'active') returning * into v_account;
    select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active limit 1;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,auth.uid(),v_role,'finance.external_receiving_account_configured','payment_account',v_account.id,jsonb_build_object('provider',p_provider,'purpose','madhouse_products_services','external_account_reference',v_ref));
  end if;
  return jsonb_build_object('id',v_account.id,'provider',v_account.provider,'purpose',v_account.purpose,'external_account_reference',v_account.external_account_reference,'status',v_account.status);
end $$;

create or replace function public.club_management_create_customer_secure(p_organisation_id uuid,p_display_name text,p_email text,p_phone text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_customer public.club_customers%rowtype; v_role text; v_email text; v_created jsonb; v_prior uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Management customer creation is not permitted' using errcode='42501';
  end if;
  v_email:=nullif(lower(btrim(p_email)),'');
  if nullif(btrim(p_display_name),'') is null or length(p_display_name)>160 or length(coalesce(v_email,''))>254
     or v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(coalesce(p_phone,''))>40 or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120 then raise exception 'Customer details are invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':management-customer:'||btrim(p_idempotency_key),0));
  select e.target_id into v_prior from public.club_audit_events e where e.organisation_id=p_organisation_id and e.action='commerce.management_customer_created' and e.metadata->>'idempotency_key'=btrim(p_idempotency_key) limit 1;
  if v_prior is not null then
    select * into v_customer from public.club_customers where id=v_prior and organisation_id=p_organisation_id;
    if not found then raise exception 'Previously created customer record is unavailable' using errcode='P0002'; end if;
    return jsonb_build_object('id',v_customer.id,'display_name',v_customer.display_name,'email',v_customer.email,'replayed',true);
  end if;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':customer-email:'||v_email,0));
    if exists(select 1 from public.club_customers c where c.organisation_id=p_organisation_id and lower(c.email)=v_email) then raise exception 'A customer with this email already exists' using errcode='23505'; end if;
  end if;
  v_created:=public.club_create_customer(p_organisation_id,null,btrim(p_display_name),v_email,nullif(btrim(p_phone),''),'customer');
  select * into v_customer from public.club_customers c where c.id=(v_created->>'id')::uuid and c.organisation_id=p_organisation_id;
  if v_customer.id is null then raise exception 'Created customer could not be resolved' using errcode='P0002'; end if;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),v_role,'commerce.management_customer_created','customer',v_customer.id,jsonb_build_object('email_provided',v_email is not null,'phone_provided',p_phone is not null,'idempotency_key',btrim(p_idempotency_key)));
  return jsonb_build_object('id',v_customer.id,'display_name',v_customer.display_name,'email',v_customer.email,'replayed',false);
end $$;

revoke all on function public.club_management_create_order_secure(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.club_management_confirm_order_secure(uuid,uuid) from public,anon,authenticated;
revoke all on function public.club_management_record_order_payment_secure(uuid,uuid,integer,text,timestamptz,text,text,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.club_management_verify_order_payment_secure(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.club_management_cancel_order_secure(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.club_management_list_orders_secure(uuid,text,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.club_management_search_order_products_secure(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.club_management_list_payment_accounts_secure(uuid) from public,anon,authenticated;
revoke all on function public.club_management_configure_payment_account_secure(uuid,text,text) from public,anon,authenticated;
revoke all on function public.club_management_create_customer_secure(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.club_management_create_order_secure(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.club_management_confirm_order_secure(uuid,uuid) to authenticated;
grant execute on function public.club_management_record_order_payment_secure(uuid,uuid,integer,text,timestamptz,text,text,uuid,integer,text) to authenticated;
grant execute on function public.club_management_verify_order_payment_secure(uuid,uuid,text,text) to authenticated;
grant execute on function public.club_management_cancel_order_secure(uuid,uuid,text) to authenticated;
grant execute on function public.club_management_list_orders_secure(uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.club_management_search_order_products_secure(uuid,text,integer) to authenticated;
grant execute on function public.club_management_list_payment_accounts_secure(uuid) to authenticated;
grant execute on function public.club_management_configure_payment_account_secure(uuid,text,text) to authenticated;
grant execute on function public.club_management_create_customer_secure(uuid,text,text,text,text) to authenticated;

commit;

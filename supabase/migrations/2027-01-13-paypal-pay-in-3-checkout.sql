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

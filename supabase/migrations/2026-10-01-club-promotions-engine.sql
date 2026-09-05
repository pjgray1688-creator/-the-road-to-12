-- R12 Promotions Engine: durable configuration, historical evidence and Golden Ticket concurrency.
-- Review/install manually; this migration seeds no offers and makes no provider calls.

create table if not exists public.club_promotion_applied_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null references public.club_orders(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  promotion_name text not null,
  gross_minor integer not null check (gross_minor >= 0),
  saving_minor integer not null check (saving_minor >= 0),
  net_minor integer not null check (net_minor >= 0),
  applied_snapshot jsonb not null default '{}' check (jsonb_typeof(applied_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (organisation_id, order_id, promotion_id)
);
create index if not exists club_promotion_applied_orders_order_idx on public.club_promotion_applied_orders(organisation_id, order_id);

create table if not exists public.club_golden_ticket_redemptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid,
  calendar_month date not null,
  order_id uuid not null references public.club_orders(id) on delete restrict,
  candidate_snapshot jsonb not null check (jsonb_typeof(candidate_snapshot) = 'object'),
  saving_minor integer not null check (saving_minor > 0),
  consumed_at timestamptz not null default now(),
  unique (organisation_id, promotion_id, user_id, calendar_month),
  unique (organisation_id, promotion_id, customer_id, calendar_month)
);
create index if not exists club_golden_ticket_redemptions_order_idx on public.club_golden_ticket_redemptions(organisation_id, order_id);

alter table public.club_promotion_applied_orders enable row level security;
alter table public.club_golden_ticket_redemptions enable row level security;
revoke all on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions from public, anon, authenticated;
grant select on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions to authenticated;
create policy club_promotion_applied_orders_staff on public.club_promotion_applied_orders for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_golden_ticket_redemptions_staff on public.club_golden_ticket_redemptions for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or user_id=auth.uid());

-- Lifecycle is configuration plus time; a future-dated row is never economically active.
create or replace function public.club_promotion_lifecycle(p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_now timestamptz default now())
returns text language sql immutable as $$
  select case when p_status in ('paused','expired','draft') then p_status
    when p_ends_at is not null and p_now >= p_ends_at then 'expired'
    when p_now < p_starts_at then 'scheduled'
    else 'active' end
$$;

-- Authoritative promotion evaluation for checkout. Inputs are intent only; product prices are read from canonical catalogue rows.
create or replace function public.club_evaluate_commerce_promotions(p_organisation_id uuid, p_location_id uuid, p_user_id uuid, p_customer_id uuid, p_items jsonb, p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item jsonb; v_product public.club_commerce_products%rowtype; v_gross integer:=0; v_discount integer:=0; v_effect public.club_promotion_effects%rowtype; v_p public.club_promotions%rowtype; v_line integer; v_applied jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Promotion evaluation is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]')) <> 'array' then raise exception 'Invalid basket' using errcode='22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active;
    if not found or coalesce((v_item->>'quantity')::integer,0) <= 0 then raise exception 'Product is not sellable' using errcode='22023'; end if;
    v_line := v_product.sell_price_minor * (v_item->>'quantity')::integer; v_gross := v_gross + v_line;
  end loop;
  for v_p in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now() >= starts_at and (ends_at is null or now() < ends_at) and (cardinality(location_ids)=0 or p_location_id = any(location_ids)) and (not exists(select 1 from public.club_promotion_targets t where t.promotion_id=club_promotions.id) or exists(select 1 from public.club_promotion_targets t where t.promotion_id=club_promotions.id and (t.target_type='all_commerce' or exists(select 1 from jsonb_array_elements(p_items) bi where t.target_type='commerce_product' and t.commerce_product_id=(bi->>'product_id')::uuid) or exists(select 1 from jsonb_array_elements(p_items) bi join public.club_commerce_products cp on cp.id=(bi->>'product_id')::uuid and cp.organisation_id=p_organisation_id where t.target_type='commerce_category' and cp.category=t.category_key))) order by coalesce((eligibility->>'priority')::integer,0) desc, id loop
    select * into v_effect from public.club_promotion_effects where promotion_id=v_p.id order by id limit 1;
    if v_effect.effect_type='percentage_discount' then v_line := floor(v_gross * v_effect.percentage_basis_points / 10000); elsif v_effect.effect_type='fixed_discount' then v_line := v_effect.amount_minor; elsif v_effect.effect_type='waive_charge' then v_line := 0; else v_line := 0; end if;
    v_line := least(v_gross, greatest(0, coalesce(v_line,0))); if v_line > v_discount then v_discount := v_line; v_applied := jsonb_build_array(jsonb_build_object('promotion_id',v_p.id,'promotion_name',v_p.name,'saving_minor',v_line,'effect_type',v_effect.effect_type)); end if;
  end loop;
  return jsonb_build_object('gross_minor',v_gross,'discount_minor',v_discount,'total_minor',greatest(0,v_gross-v_discount),'applied',v_applied,'payment_method',p_payment_method);
end; $$;
revoke all on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- Corrected allocator: each instance is attempted against a copy of remaining;
-- failed partial attempts are discarded, so leftovers are never consumed.
create or replace function public.club_resolve_promotion_bundles(p_organisation_id uuid,p_items jsonb,p_groups jsonb,p_bundle_price_minor integer,p_repeatable boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare remaining jsonb:='[]'::jsonb; trial jsonb; grp jsonb; item jsonb; components jsonb; instances jsonb:='[]'::jsonb; need integer; take integer; qty integer; original integer; idx integer; made integer:=0; ok boolean; prod public.club_commerce_products%rowtype;
begin
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]')) order by value->>'product_id' loop select * into prod from public.club_commerce_products where id=(item->>'product_id')::uuid and organisation_id=p_organisation_id and active; if not found then raise exception 'Bundle product is unavailable' using errcode='22023'; end if; remaining:=remaining||jsonb_build_array(jsonb_build_object('product_id',prod.id,'category',prod.category,'quantity',(item->>'quantity')::integer,'unit_price_minor',prod.sell_price_minor)); end loop;
  loop
    trial:=remaining; components:='[]'::jsonb; ok:=true; idx:=0;
    while idx<jsonb_array_length(coalesce(p_groups,'[]')) loop grp:=p_groups->idx; need:=coalesce((grp->>'required_quantity')::integer,0); for item in select value from jsonb_array_elements(trial) order by value->>'product_id' loop exit when need=0; qty:=coalesce((item->>'quantity')::integer,0); if qty>0 and (grp->'product_ids' is null or (grp->'product_ids') ? (item->>'product_id')) and (grp->'categories' is null or (grp->'categories') ? coalesce(item->>'category','')) then take:=least(need,qty); components:=components||jsonb_build_array(jsonb_build_object('group_id',coalesce(grp->>'group_id',idx::text),'group_order',idx,'product_id',item->>'product_id','category',item->>'category','quantity',take,'unit_price_minor',(item->>'unit_price_minor')::integer,'original_minor',take*(item->>'unit_price_minor')::integer)); trial:=coalesce((select jsonb_agg(case when value->>'product_id'=item->>'product_id' then jsonb_set(value,'{quantity}',to_jsonb(qty-take)) else value end order by value->>'product_id') from jsonb_array_elements(trial)),'[]'::jsonb); need:=need-take; end if; end loop; if need>0 then ok:=false; exit; end if; idx:=idx+1; end loop;
    if not ok then exit; end if; remaining:=trial; original:=coalesce((select sum((value->>'original_minor')::integer) from jsonb_array_elements(components)),0); made:=made+1; instances:=instances||jsonb_build_array(jsonb_build_object('bundle_instance',made,'original_minor',original,'bundle_price_minor',p_bundle_price_minor,'saving_minor',greatest(0,original-p_bundle_price_minor),'components',components)); if not p_repeatable then exit; end if;
  end loop;
  return jsonb_build_object('bundle_count',made,'instances',instances,'remaining',remaining);
end; $$;
revoke all on function public.club_resolve_promotion_bundles(uuid,jsonb,jsonb,integer,boolean) from public,anon,authenticated;

-- Golden Ticket consumption is intentionally callable only by trusted finalisation code (service role).
create or replace function public.club_consume_golden_ticket(p_organisation_id uuid,p_promotion_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_candidate jsonb,p_saving_minor integer,p_calendar_month date default date_trunc('month',now())::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_golden_ticket_redemptions%rowtype;
begin
  if auth.uid() is not null then raise exception 'Trusted finalisation required' using errcode='42501'; end if;
  if p_saving_minor <= 0 or p_candidate is null or p_order_id is null then raise exception 'Invalid Golden Ticket redemption' using errcode='22023'; end if;
  if not exists(select 1 from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and status in ('paid','fulfilled') and total_minor >= 0) then raise exception 'Order is not complete' using errcode='22023'; end if;
  insert into public.club_golden_ticket_redemptions(organisation_id,promotion_id,user_id,customer_id,calendar_month,order_id,candidate_snapshot,saving_minor) values(p_organisation_id,p_promotion_id,p_user_id,p_customer_id,p_calendar_month,p_order_id,p_candidate,p_saving_minor) on conflict do nothing returning * into v_row;
  if not found then select * into v_row from public.club_golden_ticket_redemptions where organisation_id=p_organisation_id and promotion_id=p_promotion_id and calendar_month=p_calendar_month and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) limit 1; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_consume_golden_ticket(uuid,uuid,uuid,uuid,uuid,jsonb,integer,date) from public,anon,authenticated;

alter table public.club_golden_ticket_redemptions drop constraint if exists club_golden_ticket_identity_required;
alter table public.club_golden_ticket_redemptions add constraint club_golden_ticket_identity_required check (user_id is not null or customer_id is not null);

-- Validate redemption against immutable applied evidence; trusted finalisation must not fabricate it.
create or replace function public.club_consume_golden_ticket(p_organisation_id uuid,p_promotion_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_candidate jsonb,p_saving_minor integer,p_calendar_month date default date_trunc('month',now())::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_golden_ticket_redemptions%rowtype; v_e public.club_promotion_applied_orders%rowtype;
begin
  if p_user_id is null and p_customer_id is null then raise exception 'Identified finalisation required' using errcode='42501'; end if;
  select * into v_e from public.club_promotion_applied_orders where organisation_id=p_organisation_id and order_id=p_order_id and promotion_id=p_promotion_id for share;
  if not found or v_e.net_minor is null or v_e.saving_minor<>p_saving_minor or (v_e.applied_snapshot->'golden_ticket_candidate') is distinct from p_candidate then raise exception 'Golden Ticket evidence does not match order' using errcode='22023'; end if;
  if not exists(select 1 from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and status in ('paid','fulfilled')) then raise exception 'Order is not complete' using errcode='22023'; end if;
  insert into public.club_golden_ticket_redemptions(organisation_id,promotion_id,user_id,customer_id,calendar_month,order_id,candidate_snapshot,saving_minor) values(p_organisation_id,p_promotion_id,p_user_id,p_customer_id,p_calendar_month,p_order_id,p_candidate,p_saving_minor) on conflict do nothing returning * into v_row;
  if not found then select * into v_row from public.club_golden_ticket_redemptions where organisation_id=p_organisation_id and promotion_id=p_promotion_id and calendar_month=p_calendar_month and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) limit 1; end if;
  return to_jsonb(v_row);
end; $$;

-- Administration changes are append-only evidence, without copying sensitive configuration into audit text.
create or replace function public.club_promotion_audit_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
  values(coalesce(new.organisation_id,old.organisation_id),coalesce(auth.uid(),new.created_by),case when tg_op='INSERT' then 'promotion.created' when tg_op='UPDATE' then 'promotion.updated' else 'promotion.deleted' end,'promotion',coalesce(new.id,old.id),jsonb_build_object('operation',tg_op,'name',coalesce(new.name,old.name),'status',coalesce(new.status,old.status)));
  return coalesce(new,old);
end; $$;
drop trigger if exists club_promotions_audit on public.club_promotions;
create trigger club_promotions_audit after insert or update or delete on public.club_promotions for each row execute function public.club_promotion_audit_trigger();

-- Canonical order creation now resolves configured promotions in the trusted database path.
create or replace function public.club_create_commerce_order(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_channel text,p_currency text,p_items jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item jsonb; v_product public.club_commerce_products%rowtype; v_qty integer; v_subtotal integer:=0; v_pricing jsonb; v_discount integer; v_staff boolean; v_existing public.club_orders%rowtype; v_applied jsonb;
begin
  if auth.uid() is null or p_channel not in ('member_app','staff_checkout','quick_sale','web','other') or p_currency !~ '^[A-Z]{3}$' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Invalid order input' using errcode='22023'; end if;
  v_staff:=public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']); if not v_staff and p_channel not in ('member_app','web') then raise exception 'Order channel is not permitted' using errcode='42501'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location is unavailable' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and (v_staff or user_id=auth.uid())) then raise exception 'Customer is not in organisation' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_orders where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return jsonb_build_object('order',to_jsonb(v_existing),'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_existing.id),'[]'::jsonb),'replayed',true); end if; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop v_qty:=(v_item->>'quantity')::integer; if v_qty is null or v_qty<=0 then raise exception 'Invalid order quantity' using errcode='22023'; end if; select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active for update; if not found or (v_product.stock_tracked and p_location_id is null) or v_product.currency<>p_currency then raise exception 'Product is unavailable' using errcode='22023'; end if; v_subtotal:=v_subtotal+v_product.sell_price_minor*v_qty; end loop;
  v_pricing:=public.club_evaluate_commerce_promotions(p_organisation_id,p_location_id,auth.uid(),p_customer_id,p_items,null); v_discount:=least(v_subtotal,greatest(0,(v_pricing->>'discount_minor')::integer));
  insert into public.club_orders(organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_by,idempotency_key) values(p_organisation_id,p_location_id,p_customer_id,case when v_staff then null else auth.uid() end,p_channel,'pending_payment',p_currency,v_subtotal,v_discount,v_subtotal-v_discount,auth.uid(),p_idempotency_key) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_items) loop select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id; v_qty:=(v_item->>'quantity')::integer; insert into public.club_order_items(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked) values(v_order.id,p_organisation_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sell_price_minor,v_product.sell_price_minor*v_qty,v_product.stock_tracked); end loop;
  for v_applied in select * from jsonb_array_elements(coalesce(v_pricing->'applied','[]'::jsonb)) loop insert into public.club_promotion_applied_orders(organisation_id,order_id,promotion_id,promotion_name,gross_minor,saving_minor,net_minor,applied_snapshot) values(p_organisation_id,v_order.id,(v_applied->>'promotion_id')::uuid,v_applied->>'promotion_name',v_subtotal,(v_applied->>'saving_minor')::integer,v_order.total_minor,jsonb_build_object('promotion',v_applied,'basket',p_items,'golden_ticket_candidate',v_applied->'golden_ticket_candidate')); end loop;
  return jsonb_build_object('order',to_jsonb(v_order),'items',(select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_order.id),'pricing',v_pricing,'replayed',false);
end; $$;
revoke all on function public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text) to authenticated;

-- Extend the already-live canonical finaliser. Promotion evidence and Golden Ticket
-- consumption are part of the same locked transaction as stock/service effects.
create or replace function public.club_finalize_paid_order(p_order_id uuid, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; i public.club_order_items%rowtype; p public.club_commerce_products%rowtype; paid integer; customer uuid; e public.club_promotion_applied_orders%rowtype; candidate jsonb;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or (o.status<>'paid' and not (o.status='pending_payment' and o.total_minor=0)) then raise exception 'Paid order is required for finalisation' using errcode='22023'; end if;
  if o.total_minor>0 then select coalesce(sum(amount_minor),0) into paid from public.club_payments where organisation_id=o.organisation_id and order_id=o.id and status='paid'; if paid<>o.total_minor then raise exception 'Successful tender total does not match order' using errcode='22023'; end if; if exists(select 1 from public.club_promotion_applied_orders e join public.club_promotions pr on pr.id=e.promotion_id where e.order_id=o.id and pr.eligibility->>'payment_method'='balance_only') and exists(select 1 from public.club_payments where order_id=o.id and status='paid' and method<>'balance') then raise exception 'Promotion tender condition was not met' using errcode='22023'; end if; end if;
  if o.status='pending_payment' then update public.club_orders set status='paid',updated_at=now() where id=o.id returning * into o; end if;
  for i in select * from public.club_order_items where order_id=o.id order by id loop
    if i.stock_tracked then insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(o.organisation_id,o.location_id,i.product_id,'sale',-i.quantity,o.id,p_actor_user_id,'order-finalise:'||i.id::text) on conflict (organisation_id,idempotency_key) do nothing; end if;
    select * into p from public.club_commerce_products where id=i.product_id and organisation_id=o.organisation_id;
    if p.service_id is not null then customer:=o.customer_id; if customer is null and o.user_id is not null then select id into customer from public.club_customers where organisation_id=o.organisation_id and user_id=o.user_id limit 1; end if; insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata) values(o.organisation_id,o.location_id,p.service_id,customer,p_actor_user_id,i.quantity,i.unit_price_minor,o.currency,'paid','commerce',o.id::text,'pending',i.id,jsonb_build_object('commerce_order_id',o.id)) on conflict (commerce_order_item_id) do nothing; end if;
  end loop;
  perform public.club_create_supplier_demand_for_order(o.id);
  for e in select * from public.club_promotion_applied_orders where organisation_id=o.organisation_id and order_id=o.id loop
    if not exists(select 1 from public.club_promotion_applied_orders where id=e.id) then raise exception 'Promotion evidence missing' using errcode='22023'; end if;
    candidate:=e.applied_snapshot->'golden_ticket_candidate'; if candidate is not null and candidate <> 'null'::jsonb then perform public.club_consume_golden_ticket(o.organisation_id,e.promotion_id, o.user_id,o.customer_id,o.id,candidate,e.saving_minor); end if;
  end loop;
end; $$;
revoke all on function public.club_finalize_paid_order(uuid,uuid) from public,anon,authenticated;

-- Final evaluator: targeted bases, repeatable persisted JSON bundle groups and
-- configurable Golden Ticket candidates. All values come from canonical products.
create or replace function public.club_evaluate_commerce_promotions(p_organisation_id uuid,p_location_id uuid,p_user_id uuid,p_customer_id uuid,p_items jsonb,p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; c jsonb; g jsonb; t public.club_promotion_targets%rowtype; pr public.club_promotions%rowtype; ef public.club_promotion_effects%rowtype; prod public.club_commerce_products%rowtype; gross integer:=0; base integer; saving integer; total integer; applied jsonb:='[]'::jsonb; bundles jsonb; bundle_count integer; group_count integer; group_idx integer; eligible_count integer; candidate_base integer; candidate_save integer; best_save integer:=0; best jsonb; month_start date:=date_trunc('month',now())::date;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Promotion evaluation is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'))<>'array' then raise exception 'Invalid basket' using errcode='22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id and active for share; if not found or coalesce((x->>'quantity')::integer,0)<=0 then raise exception 'Product is not sellable' using errcode='22023'; end if; gross:=gross+prod.sell_price_minor*(x->>'quantity')::integer; end loop;
  for pr in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now()>=starts_at and (ends_at is null or now()<ends_at) and (cardinality(location_ids)=0 or p_location_id=any(location_ids)) order by coalesce((eligibility->>'priority')::integer,0) desc,id loop
    if pr.eligibility->>'payment_method'='balance_only' and p_payment_method is distinct from 'balance' then continue; end if;
    base:=0;
    for x in select * from jsonb_array_elements(p_items) loop
      select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id;
      if not exists(select 1 from public.club_promotion_targets t0 where t0.promotion_id=pr.id) or exists(select 1 from public.club_promotion_targets t0 where t0.promotion_id=pr.id and (t0.target_type='all_commerce' or (t0.target_type='commerce_product' and t0.commerce_product_id=prod.id) or (t0.target_type='commerce_category' and t0.category_key=prod.category)) ) then base:=base+prod.sell_price_minor*(x->>'quantity')::integer; end if;
    end loop;
    if base=0 then continue; end if;
    select * into ef from public.club_promotion_effects where promotion_id=pr.id order by id limit 1;
    if ef.effect_type='percentage_discount' then saving:=floor(base*ef.percentage_basis_points/10000); elsif ef.effect_type='fixed_discount' then saving:=ef.amount_minor; elsif ef.effect_type='waive_charge' then saving:=base; else saving:=0; end if; saving:=least(base,greatest(0,coalesce(saving,0)));
    if pr.eligibility ? 'bundle_groups' and pr.eligibility ? 'bundle_price_minor' then
      bundles:=public.club_resolve_promotion_bundles(p_organisation_id,p_items,pr.eligibility->'bundle_groups',(pr.eligibility->>'bundle_price_minor')::integer,coalesce((pr.eligibility->>'repeatable')::boolean,true)); bundle_count:=(bundles->>'bundle_count')::integer; group_count:=0;
      if group_count>0 then
        loop
          group_idx:=0; while group_idx<group_count loop g:=pr.eligibility->'bundle_groups'->group_idx; eligible_count:=0; for x in select * from jsonb_array_elements(p_items) loop select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id; if (g->'product_ids' is null or (g->'product_ids') ? prod.id::text) and (g->'categories' is null or (g->'categories') ? prod.category) then eligible_count:=eligible_count+(x->>'quantity')::integer; end if; end loop; if coalesce((g->>'required_quantity')::integer,0)<=0 then eligible_count:=0; end if; if group_idx=0 or floor(eligible_count/(g->>'required_quantity')::integer)<bundle_count then bundle_count:=floor(eligible_count/(g->>'required_quantity')::integer); end if; group_idx:=group_idx+1; end loop;
          if bundle_count<=0 or coalesce((pr.eligibility->>'repeatable')::boolean,true)=false then exit; end if;
          exit;
        end loop;
      end if;
      if bundle_count>0 then saving:=coalesce((select sum((value->>'saving_minor')::integer) from jsonb_array_elements(bundles->'instances')),0); end if;
      applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',saving,'effect_type','bundle','bundle_count',bundle_count,'bundle_groups',pr.eligibility->'bundle_groups','bundle_instances',bundles->'instances','remaining',bundles->'remaining'));
    elsif saving>0 then
      applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',saving,'effect_type',ef.effect_type,'base_minor',base,'stacking',coalesce(pr.eligibility->>'stacking','exclusive')));
    end if;
    if coalesce(pr.eligibility->>'stacking','exclusive')<>'combinable' then exit; end if;
  end loop;
  -- Golden Ticket is opt-in configuration, never inferred from its name.
  for pr in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now()>=starts_at and (ends_at is null or now()<ends_at) and coalesce((eligibility->>'golden_ticket')::boolean,false) and (p_user_id is not null) and exists(select 1 from public.club_entitlement_grants eg where eg.organisation_id=p_organisation_id and eg.user_id=p_user_id and eg.entitlement_key=coalesce(pr.eligibility->>'entitlement_key','golden_ticket') and eg.starts_at<=now() and (eg.ends_at is null or eg.ends_at>now()) and (eg.membership_id is null or exists(select 1 from public.club_membership_holders mh join public.club_memberships mm on mm.id=mh.membership_id and mm.organisation_id=p_organisation_id where mh.membership_id=eg.membership_id and mh.user_id=p_user_id and mm.status='active'))) and not exists(select 1 from public.club_golden_ticket_redemptions r where r.organisation_id=p_organisation_id and r.promotion_id=pr.id and r.calendar_month=month_start and ((p_user_id is not null and r.user_id=p_user_id) or (p_customer_id is not null and r.customer_id=p_customer_id))) loop
    best:=null; best_save:=0;
    for c in select * from jsonb_array_elements(coalesce(pr.eligibility->'golden_candidates','[]'::jsonb)) loop candidate_base:=0; for x in select * from jsonb_array_elements(p_items) loop select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id; if (c->>'type'='product' and c->>'id'=prod.id::text) or (c->>'type'='category' and c->>'id'=prod.category) then candidate_base:=candidate_base+prod.sell_price_minor*(x->>'quantity')::integer; end if; end loop; candidate_save:=floor(candidate_base*2000/10000); if candidate_save>best_save or (candidate_save=best_save and candidate_save>0 and (best is null or (c->>'id')<(best->>'id'))) then best_save:=candidate_save; best:=jsonb_build_object('type',c->>'type','id',c->>'id','base_minor',candidate_base,'saving_minor',candidate_save,'included_items',p_items); end if; end loop;
    if best is not null and best_save>0 then applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',best_save,'effect_type','golden_ticket','base_minor',best->>'base_minor','golden_ticket_candidate',best)); end if;
  end loop;
  total:=greatest(0,gross-(select coalesce(sum((a->>'saving_minor')::integer),0) from jsonb_array_elements(applied) a)); return jsonb_build_object('gross_minor',gross,'discount_minor',gross-total,'total_minor',total,'applied',applied,'payment_method',p_payment_method);
end; $$;
revoke all on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

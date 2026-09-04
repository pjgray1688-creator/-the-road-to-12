-- Collection shelf confirmation, manual shelf reminders, stock removals and
-- auditable discounts. No automatic pickup inference or provider messaging.

alter table public.club_supplier_demand add column if not exists collection_code text;
alter table public.club_supplier_demand add column if not exists shelf_confirmed_at timestamptz;
alter table public.club_supplier_demand add column if not exists shelf_confirmed_by uuid references auth.users(id) on delete set null;
update public.club_supplier_demand set collection_code=coalesce(collection_code,'COL-'||replace(id::text,'-','')) where collection_code is null;
alter table public.club_supplier_demand alter column collection_code set default ('COL-'||replace(gen_random_uuid()::text,'-',''));
alter table public.club_supplier_demand alter column collection_code set not null;
create unique index if not exists club_supplier_demand_collection_code_uq on public.club_supplier_demand(organisation_id,collection_code);
create unique index if not exists club_collection_reminder_once_uq on public.club_notification_events(organisation_id,order_id,event_type) where event_type='collection_shelf_reminder';

create table if not exists public.club_stock_removals (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, product_id uuid not null, quantity integer not null check(quantity>0), reason text not null check(reason in ('staff_consumption','complimentary','promotion_sample','damaged','waste','other')),
  note text, retail_unit_price_minor integer check(retail_unit_price_minor is null or retail_unit_price_minor>=0), cost_unit_minor integer check(cost_unit_minor is null or cost_unit_minor>=0), actor_user_id uuid not null references auth.users(id) on delete restrict,
  authorising_user_id uuid references auth.users(id) on delete set null, idempotency_key text not null, created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), unique(id,organisation_id),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  foreign key(product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict
);

create table if not exists public.club_order_discounts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, order_id uuid not null,
  kind text not null check(kind in ('percentage','fixed','comp')), value_minor integer check(value_minor is null or value_minor>=0), percent numeric check(percent is null or (percent>=0 and percent<=100)), discount_minor integer not null check(discount_minor>=0), reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict, authorising_user_id uuid references auth.users(id) on delete set null, idempotency_key text not null, created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), unique(order_id), foreign key(order_id,organisation_id) references public.club_orders(id,organisation_id) on delete restrict
);
alter table public.club_stock_removals enable row level security; alter table public.club_order_discounts enable row level security;
revoke all on table public.club_stock_removals,public.club_order_discounts from public,anon,authenticated;

create or replace function public.club_confirm_supplier_shelf_ready(p_organisation_id uuid,p_demand_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_supplier_demand%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf confirmation is not permitted' using errcode='42501'; end if;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or d.status not in ('received','ready_for_collection') or d.quantity_received<d.quantity_required or d.quantity_allocated<d.quantity_required then raise exception 'Customer allocation is not ready for shelf placement' using errcode='22023'; end if;
  update public.club_supplier_demand set status='ready_for_collection',ready_at=coalesce(ready_at,now()),shelf_confirmed_at=coalesce(shelf_confirmed_at,now()),shelf_confirmed_by=coalesce(shelf_confirmed_by,auth.uid()),updated_at=now() where id=d.id returning * into d;
  insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'order_ready_for_collection',d.order_id,jsonb_build_object('state','queued','collection_code',d.collection_code)) on conflict(order_id,event_type) do nothing;
  return to_jsonb(d);
end; $$;

-- Allocation records physical receipt/ownership first. Shelf confirmation is a
-- deliberate later step for unstaffed locations and is the only ready transition.
create or replace function public.club_allocate_supplier_units(p_organisation_id uuid,p_receipt_line_id uuid,p_demand_id uuid,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rl public.club_supplier_receipt_lines%rowtype; d public.club_supplier_demand%rowtype; used integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') or p_quantity<1 then raise exception 'Supplier allocation is not permitted' using errcode='42501'; end if;
  select * into rl from public.club_supplier_receipt_lines where id=p_receipt_line_id for update;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or not exists(select 1 from public.club_supplier_order_batch_lines bl join public.club_supplier_receipts r on r.batch_id=bl.batch_id where bl.id=rl.batch_line_id and r.organisation_id=p_organisation_id and bl.supplier_product_id=d.supplier_product_id and d.batch_id=bl.batch_id) then raise exception 'Allocation target is invalid' using errcode='22023'; end if;
  select coalesce(sum(quantity_allocated),0) into used from public.club_supplier_allocations where receipt_line_id=rl.id;
  if used+p_quantity>rl.quantity_received or d.quantity_allocated+p_quantity>d.quantity_required then raise exception 'Allocation exceeds available quantity' using errcode='22023'; end if;
  insert into public.club_supplier_allocations(organisation_id,receipt_line_id,demand_id,quantity_allocated,allocated_by) values(p_organisation_id,rl.id,d.id,p_quantity,auth.uid());
  update public.club_supplier_demand set quantity_allocated=quantity_allocated+p_quantity,quantity_received=quantity_received+p_quantity,updated_at=now() where id=d.id returning * into d;
  if d.quantity_allocated>=d.quantity_required then update public.club_supplier_demand set status='received',updated_at=now() where id=d.id and status not in ('collected','cancelled') returning * into d; end if;
  return to_jsonb(d);
end; $$;

create or replace function public.club_list_collection_shelf_checks(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf checks are not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'collection_code',d.collection_code,'order_id',d.order_id,'user_id',d.user_id,'location_id',d.collection_location_id,'ready_at',d.ready_at,'days_ready',floor(extract(epoch from(now()-d.ready_at))/86400)::integer) order by d.ready_at), '[]'::jsonb) into result
  from public.club_supplier_demand d where d.organisation_id=p_organisation_id and d.status='ready_for_collection' and d.ready_at<=now()-interval '3 days' and (p_location_id is null or d.collection_location_id=p_location_id);
  return result;
end; $$;

create or replace function public.club_list_collection_shelf_queue(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf queue is not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'collection_code',x.collection_code,'order_id',x.order_id,'user_id',x.user_id,'location_id',x.location_id,'order_reference',left(x.order_id::text,8),'member_name',coalesce(c.display_name,'Member'),'collection_location',coalesce(l.name,'Collection area'),'items_summary',x.items_summary,'ready_at',x.ready_at,'shelf_confirmed_at',x.shelf_confirmed_at,'status',x.status) order by x.ready_at), '[]'::jsonb) into result
  from (select d.id,d.collection_code,d.order_id,d.user_id,d.collection_location_id as location_id,d.ready_at,d.shelf_confirmed_at,d.status,string_agg(coalesce(cp.name,sp.name)||' × '||d.quantity_required::text,', ' order by sp.name) as items_summary
        from public.club_supplier_demand d join public.club_supplier_products sp on sp.id=d.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id
        where d.organisation_id=p_organisation_id and d.status in ('received','ready_for_collection') and d.quantity_received>=d.quantity_required and d.quantity_allocated>=d.quantity_required and (p_location_id is null or d.collection_location_id=p_location_id)
        group by d.id,d.collection_code,d.order_id,d.user_id,d.collection_location_id,d.ready_at,d.shelf_confirmed_at,d.status) x
  left join public.club_customers c on c.organisation_id=p_organisation_id and c.user_id=x.user_id
  left join public.club_locations l on l.id=x.location_id and l.organisation_id=p_organisation_id;
  return result;
end; $$;

create or replace function public.club_scan_collection_shelf_reminder(p_organisation_id uuid,p_collection_code text,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_supplier_demand%rowtype; n public.club_notification_events%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Collection reminder is not permitted' using errcode='42501'; end if;
  select * into d from public.club_supplier_demand where organisation_id=p_organisation_id and collection_code=btrim(p_collection_code) and collection_location_id=p_location_id for update;
  if not found or d.status<>'ready_for_collection' or d.ready_at>now()-interval '3 days' then raise exception 'Collection shelf reminder is not eligible' using errcode='22023'; end if;
  insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'collection_shelf_reminder',d.order_id,jsonb_build_object('state','queued','collection_code',d.collection_code,'physical_check','confirmed_present')) on conflict(organisation_id,order_id,event_type) do nothing returning * into n;
  return jsonb_build_object('demand',to_jsonb(d),'notification',case when n.id is null then jsonb_build_object('already_recorded',true) else to_jsonb(n) end);
end; $$;

create or replace function public.club_record_stock_removal(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_quantity integer,p_reason text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare product public.club_commerce_products%rowtype; r public.club_stock_removals%rowtype; existing public.club_stock_removals%rowtype; available integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'inventory.adjust') then raise exception 'Stock removal is not permitted' using errcode='42501'; end if;
  if p_quantity<1 or p_reason not in ('staff_consumption','complimentary','promotion_sample','damaged','waste','other') or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Invalid stock removal' using errcode='22023'; end if;
  select * into existing from public.club_stock_removals where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(existing); end if;
  select * into product from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id and active and stock_tracked for share; if not found then raise exception 'Stock product is unavailable' using errcode='P0002'; end if;
  select coalesce(sum(quantity_delta),0) into available from public.club_stock_movements where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id;
  if available < p_quantity then raise exception 'Insufficient free stock' using errcode='22003'; end if;
  insert into public.club_stock_removals(organisation_id,location_id,product_id,quantity,reason,note,retail_unit_price_minor,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_product_id,p_quantity,p_reason,p_note,product.sell_price_minor,auth.uid(),p_idempotency_key) returning * into r;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_product_id,'waste',-p_quantity,'stock_removal:'||p_reason,auth.uid(),'removal:'||r.id::text) on conflict(organisation_id,idempotency_key) do nothing;
  return to_jsonb(r);
end; $$;

create or replace function public.club_apply_order_discount(p_organisation_id uuid,p_order_id uuid,p_kind text,p_value_minor integer,p_percent numeric,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; d public.club_order_discounts%rowtype; existing public.club_order_discounts%rowtype; discount integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or nullif(btrim(p_reason),'') is null or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Discounting is not permitted' using errcode='42501'; end if;
  select * into existing from public.club_order_discounts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return jsonb_build_object('discount',to_jsonb(existing),'order_id',existing.order_id,'total_minor',(select total_minor from public.club_orders where id=existing.order_id and organisation_id=p_organisation_id)); end if;
  select * into o from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update; if not found or o.status<>'pending_payment' then raise exception 'Order is not discountable' using errcode='22023'; end if;
  if exists(select 1 from public.club_order_discounts where order_id=o.id) then raise exception 'Order already has a discount' using errcode='23505'; end if;
  discount:=case when p_kind='percentage' then round(o.subtotal_minor*coalesce(p_percent,0)/100)::integer when p_kind in ('fixed','comp') then coalesce(p_value_minor,0) else -1 end;
  if discount<0 or discount>o.subtotal_minor then raise exception 'Discount exceeds order value' using errcode='22023'; end if;
  insert into public.club_order_discounts(organisation_id,order_id,kind,value_minor,percent,discount_minor,reason,actor_user_id,idempotency_key) values(p_organisation_id,o.id,p_kind,p_value_minor,p_percent,discount,p_reason,auth.uid(),p_idempotency_key) returning * into d;
  update public.club_orders set discount_minor=discount,total_minor=o.subtotal_minor-discount,updated_at=now() where id=o.id;
  return jsonb_build_object('discount',to_jsonb(d),'order_id',o.id,'total_minor',o.subtotal_minor-discount);
end; $$;

revoke all on function public.club_confirm_supplier_shelf_ready(uuid,uuid),public.club_list_collection_shelf_checks(uuid,uuid),public.club_list_collection_shelf_queue(uuid,uuid),public.club_scan_collection_shelf_reminder(uuid,text,uuid),public.club_record_stock_removal(uuid,uuid,uuid,integer,text,text,text),public.club_apply_order_discount(uuid,uuid,text,integer,numeric,text,text) from public,anon;
grant execute on function public.club_confirm_supplier_shelf_ready(uuid,uuid),public.club_list_collection_shelf_checks(uuid,uuid),public.club_list_collection_shelf_queue(uuid,uuid),public.club_scan_collection_shelf_reminder(uuid,text,uuid),public.club_record_stock_removal(uuid,uuid,uuid,integer,text,text,text),public.club_apply_order_discount(uuid,uuid,text,integer,numeric,text,text) to authenticated;

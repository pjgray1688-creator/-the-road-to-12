begin;

do $$
begin
  if to_regclass('public.club_orders') is null
    or to_regclass('public.club_order_items') is null
    or to_regclass('public.club_commerce_products') is null
    or to_regclass('public.club_customers') is null
    or to_regclass('public.club_members') is null
    or to_regclass('public.club_locations') is null
    or to_regclass('public.club_commerce_package_rules') is null
    or to_regclass('public.club_stock_reservations') is null
    or to_regclass('public.club_stock_movements') is null
    or to_regclass('public.club_audit_events') is null
    or to_regprocedure('public.club_management_create_order_secure(uuid,uuid,uuid,jsonb,text)') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
    or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
    or to_regprocedure('public.club_validate_commerce_order_item_channel()') is null
    or to_regprocedure('public.club_guard_service_package_purchase()') is null
    or to_regprocedure('public.club_guard_supplier_order_item()') is null
    or to_regprocedure('public.club_snapshot_commerce_reporting_category()') is null
    or to_regprocedure('public.club_stock_reservation_order_trigger()') is null
    or to_regprocedure('public.club_stock_reservation_sale_trigger()') is null
    or to_regprocedure('public.club_reserve_order_stock(uuid)') is null then
    raise exception 'Manual order-line prerequisites are missing; no application objects were changed';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_order_items' and column_name in ('id','order_id','organisation_id','product_id','product_name','sku','quantity','unit_price_minor','line_total_minor','stock_tracked','created_at','reporting_category') group by table_name having count(*)=12)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_orders' and column_name in ('id','organisation_id','location_id','customer_id','user_id','status','currency','subtotal_minor','discount_minor','total_minor','created_by','idempotency_key') group by table_name having count(*)=12)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_commerce_products' and column_name in ('id','organisation_id','active','name','currency','stock_tracked','sell_price_minor','service_id','sales_channels') group by table_name having count(*)=9)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_commerce_package_rules' and column_name in ('commerce_product_id','organisation_id') group by table_name having count(*)=2)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_stock_reservations' and column_name in ('organisation_id','location_id','product_id','user_id','customer_id','order_id','order_item_id','quantity','status') group by table_name having count(*)=9)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_stock_movements' and column_name in ('organisation_id','location_id','product_id','movement_type','order_id') group by table_name having count(*)=5)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name in ('id','organisation_id') group by table_name having count(*)=2)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name in ('organisation_id','user_id','role','active') group by table_name having count(*)=4)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name in ('organisation_id','actor_user_id','actor_role','action','target_type','target_id','location_id','metadata') group by table_name having count(*)=8) then
    raise exception 'Manual order-line prerequisite columns are missing; no application objects were changed';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_orders' and column_name in ('status','channel','created_by','location_id') group by table_name having count(*)=4)
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_order_items'::regclass and not t.tgisinternal
        and t.tgname='club_order_item_sales_channel'
        and t.tgfoid='public.club_validate_commerce_order_item_channel()'::regprocedure
        and t.tgenabled<>'D'
    )
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_order_items'::regclass and not t.tgisinternal
        and t.tgname='club_service_package_membership_required'
        and t.tgfoid='public.club_guard_service_package_purchase()'::regprocedure
        and t.tgenabled<>'D'
    )
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_order_items'::regclass and not t.tgisinternal
        and t.tgname='club_guard_supplier_order_item'
        and t.tgfoid='public.club_guard_supplier_order_item()'::regprocedure
        and t.tgenabled<>'D'
    )
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_order_items'::regclass and not t.tgisinternal
        and t.tgname='club_order_item_reporting_category_snapshot'
        and t.tgfoid='public.club_snapshot_commerce_reporting_category()'::regprocedure
        and t.tgenabled<>'D'
    )
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_orders'::regclass and not t.tgisinternal
        and t.tgname='club_stock_reservation_order_status'
        and t.tgfoid='public.club_stock_reservation_order_trigger()'::regprocedure
        and t.tgenabled<>'D'
    )
    or not exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.club_stock_movements'::regclass and not t.tgisinternal
        and t.tgname='club_stock_reservation_sale'
        and t.tgfoid='public.club_stock_reservation_sale_trigger()'::regprocedure
        and t.tgenabled<>'D'
    ) then
    raise exception 'Manual order-line safety triggers are missing or disabled; no application objects were changed';
  end if;
end $$;

alter table public.club_order_items alter column product_id drop not null;
alter table public.club_order_items add column if not exists line_kind text not null default 'catalogue';
alter table public.club_order_items add column if not exists manual_notes text;

do $$ begin
  alter table public.club_order_items add constraint club_order_items_manual_kind_ck check (
    (line_kind='catalogue' and product_id is not null and manual_notes is null)
    or (line_kind='manual_service' and product_id is null and not stock_tracked)
    or (line_kind='manual_physical' and ((product_id is null and not stock_tracked) or (product_id is not null and stock_tracked)))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.club_order_items add constraint club_order_items_manual_notes_ck check (manual_notes is null or length(manual_notes)<=500);
exception when duplicate_object then null; end $$;

-- Preserve the original catalogue channel guard. A NULL product is accepted
-- only for a management-authored draft staff order with a valid manual line,
-- both order-management and pricing capabilities, and a currently authorised
-- order location. Linked physical stock still goes through the normal product
-- active/organisation/POS-channel checks below.
create or replace function public.club_validate_commerce_order_item_channel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  order_channel text;
  order_status text;
  order_currency text;
  order_creator uuid;
  order_location uuid;
  channels text[];
  product_active boolean;
  product_stock_tracked boolean;
  product_service_id uuid;
  product_currency text;
begin
  select o.channel,o.status,o.currency,o.created_by,o.location_id
    into order_channel,order_status,order_currency,order_creator,order_location
  from public.club_orders o
  where o.id=new.order_id and o.organisation_id=new.organisation_id;
  if not found then
    raise exception 'Order item is outside the order organisation' using errcode='22023';
  end if;

  if new.product_id is null then
    if new.line_kind not in ('manual_service','manual_physical')
      or new.stock_tracked is distinct from false
      or new.quantity not between 1 and 50
      or new.product_name is null
      or length(btrim(new.product_name)) not between 2 and 160
      or new.unit_price_minor is null
      or new.unit_price_minor<0
      or new.line_total_minor is null
      or new.line_total_minor::numeric<>new.unit_price_minor::numeric*new.quantity
      or order_currency is distinct from 'GBP'
      or order_channel is distinct from 'staff_checkout'
      or order_status is distinct from 'draft'
      or auth.uid() is null
      or order_creator is distinct from auth.uid()
      or public.club_capability_allowed(new.organisation_id,auth.uid(),'finance.manage') is not true
      or public.club_capability_allowed(new.organisation_id,auth.uid(),'commerce.pricing_manage') is not true
      or order_location is null
      or public.club_location_authorized(new.organisation_id,order_location) is not true then
      raise exception 'Unlinked manual order lines require an authorised draft staff order' using errcode='42501';
    end if;
    return new;
  end if;

  select p.sales_channels,p.active,p.stock_tracked,p.service_id,p.currency
    into channels,product_active,product_stock_tracked,product_service_id,product_currency
  from public.club_commerce_products p
  where p.id=new.product_id and p.organisation_id=new.organisation_id;
  if not found or product_active is not true then
    raise exception 'Product is unavailable in this organisation' using errcode='22023';
  end if;

  if new.line_kind='manual_service'
    or new.line_kind not in ('catalogue','manual_physical')
    or new.stock_tracked is distinct from product_stock_tracked then
    raise exception 'Order item type does not match its product and stock configuration' using errcode='22023';
  end if;

  if order_channel is null or channels is null
    or (order_channel in ('staff_checkout','quick_sale') and not ('pos'=any(channels)))
    or (order_channel not in ('staff_checkout','quick_sale') and not ('online'=any(channels))) then
    raise exception 'Product is not available in this sales channel' using errcode='22023';
  end if;

  if new.line_kind='manual_physical' then
    if new.stock_tracked is distinct from true
      or new.quantity not between 1 and 50
      or new.product_name is null
      or length(btrim(new.product_name)) not between 2 and 160
      or new.unit_price_minor is null
      or new.unit_price_minor<0
      or new.line_total_minor is null
      or new.line_total_minor::numeric<>new.unit_price_minor::numeric*new.quantity
      or order_currency is distinct from 'GBP'
      or product_service_id is not null
      or product_currency is distinct from 'GBP'
      or order_channel is distinct from 'staff_checkout'
      or order_status is distinct from 'draft'
      or auth.uid() is null
      or order_creator is distinct from auth.uid()
      or public.club_capability_allowed(new.organisation_id,auth.uid(),'finance.manage') is not true
      or public.club_capability_allowed(new.organisation_id,auth.uid(),'commerce.pricing_manage') is not true
      or order_location is null
      or public.club_location_authorized(new.organisation_id,order_location) is not true
      or exists(select 1 from public.club_commerce_package_rules r where r.commerce_product_id=new.product_id and r.organisation_id=new.organisation_id) then
      raise exception 'Linked manual stock requires an authorised physical POS item' using errcode='42501';
    end if;
  end if;

  return new;
end; $$;
drop trigger if exists club_order_item_sales_channel on public.club_order_items;
create trigger club_order_item_sales_channel
before insert or update of product_id,order_id,organisation_id,line_kind,stock_tracked,product_name,quantity,unit_price_minor,line_total_minor
on public.club_order_items for each row execute function public.club_validate_commerce_order_item_channel();
revoke all on function public.club_validate_commerce_order_item_channel() from public,anon,authenticated;

-- Keep the order-level channel invariant intact if a later writer attempts to
-- repurpose a draft containing custom lines for the online/member checkout.
create or replace function public.club_prevent_manual_order_channel_change() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.channel is distinct from old.channel
    and new.channel is distinct from 'staff_checkout'
    and exists(
      select 1 from public.club_order_items i
      where i.order_id=old.id and i.organisation_id=old.organisation_id
        and i.line_kind in ('manual_service','manual_physical')
    ) then
    raise exception 'Orders containing manual lines must remain staff checkout orders' using errcode='22023';
  end if;
  return new;
end; $$;
drop trigger if exists club_manual_order_channel_guard on public.club_orders;
create trigger club_manual_order_channel_guard
before update of channel on public.club_orders
for each row execute function public.club_prevent_manual_order_channel_change();
revoke all on function public.club_prevent_manual_order_channel_change() from public,anon,authenticated;

create or replace function public.club_management_create_order_with_manual_lines_secure(
  p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_items jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_catalog jsonb:='[]'::jsonb; v_line jsonb; v_kind text; v_qty integer; v_price numeric; v_line_total numeric; v_manual_total numeric:=0;
  v_description text; v_notes text; v_stock_id uuid; v_stock public.club_commerce_products%rowtype;
  v_customer public.club_customers%rowtype; v_order public.club_orders%rowtype; v_result jsonb; v_replayed boolean:=false;
  v_manual_count integer:=0; v_total_count integer:=0; v_role text; v_manual_audit jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then
    raise exception 'Management order access is not permitted' using errcode='42501';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50
    or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120 then
    raise exception 'Management order input is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active)
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Order location is outside the organisation' using errcode='42501';
  end if;
  select * into v_customer from public.club_customers c where c.id=p_customer_id and c.organisation_id=p_organisation_id;
  if not found then raise exception 'Order customer is outside the organisation' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_idempotency_key,0));
  select * into v_order from public.club_orders o where o.organisation_id=p_organisation_id and o.idempotency_key=p_idempotency_key for update;
  if found then
    return jsonb_build_object('order',jsonb_build_object('id',v_order.id,'organisation_id',v_order.organisation_id,'location_id',v_order.location_id,'customer_id',v_order.customer_id,'status',v_order.status,'currency',v_order.currency,'subtotal_minor',v_order.subtotal_minor,'discount_minor',v_order.discount_minor,'total_minor',v_order.total_minor,'created_at',v_order.created_at),'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_name',i.product_name,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor,'line_kind',i.line_kind,'manual_notes',i.manual_notes) order by i.created_at,i.id) from public.club_order_items i where i.order_id=v_order.id and i.organisation_id=p_organisation_id),'[]'::jsonb),'replayed',true);
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
    v_total_count:=v_total_count+1;
    v_kind:=coalesce(v_line->>'kind','catalogue');
    if jsonb_typeof(v_line->'quantity') is distinct from 'number' then raise exception 'Order quantity is invalid' using errcode='22023'; end if;
    if (v_line->>'quantity')::numeric<>trunc((v_line->>'quantity')::numeric) or (v_line->>'quantity')::numeric not between 1 and 50 then raise exception 'Order quantity is invalid' using errcode='22023'; end if;
    v_qty:=(v_line->>'quantity')::integer;
    if v_kind='catalogue' then
      if nullif(v_line->>'product_id','') is null or v_line->>'product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Catalogue item is invalid' using errcode='22023'; end if;
      v_catalog:=v_catalog||jsonb_build_array(jsonb_build_object('product_id',(v_line->>'product_id')::uuid,'quantity',v_qty));
    elsif v_kind in ('manual_service','manual_physical') then
      if not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Manual pricing requires product-pricing permission' using errcode='42501'; end if;
      v_description:=btrim(coalesce(v_line->>'description','')); v_notes:=nullif(btrim(v_line->>'notes'),'');
      if length(v_description) not between 2 and 160 or length(coalesce(v_notes,''))>500 or (v_line ? 'notes' and v_line->'notes'<>'null'::jsonb and jsonb_typeof(v_line->'notes') is distinct from 'string') then raise exception 'Manual item details are invalid' using errcode='22023'; end if;
      if jsonb_typeof(v_line->'unit_price_minor') is distinct from 'number' then raise exception 'Manual item price is invalid' using errcode='22023'; end if;
      v_price:=(v_line->>'unit_price_minor')::numeric;
      if v_price<0 or v_price<>trunc(v_price) or v_price>2147483647 or v_price*v_qty>2147483647 then raise exception 'Manual item price is outside supported GBP limits' using errcode='22023'; end if;
      v_line_total:=v_price*v_qty; v_manual_total:=v_manual_total+v_line_total;
      if v_manual_total>2147483647 then raise exception 'Order total exceeds the supported limit' using errcode='22023'; end if;
      v_manual_count:=v_manual_count+1;
      v_stock_id:=null;
      if v_kind='manual_service' and nullif(v_line->>'stock_product_id','') is not null then raise exception 'A manual service cannot reserve physical stock' using errcode='22023'; end if;
      if v_kind='manual_physical' and nullif(v_line->>'stock_product_id','') is not null then
        if v_line->>'stock_product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Linked stock item is invalid' using errcode='22023'; end if;
        v_stock_id:=(v_line->>'stock_product_id')::uuid;
        select * into v_stock from public.club_commerce_products p where p.id=v_stock_id and p.organisation_id=p_organisation_id and p.active and p.stock_tracked and p.service_id is null and p.currency='GBP' for update;
        if not found then raise exception 'Linked stock item is unavailable in this organisation' using errcode='22023'; end if;
      end if;
      v_manual_audit:=v_manual_audit||jsonb_build_array(jsonb_build_object('kind',v_kind,'description',v_description,'quantity',v_qty,'unit_price_minor',v_price,'line_total_minor',v_line_total,'stock_linked',v_stock_id is not null));
    else
      raise exception 'Order line kind is unsupported' using errcode='22023';
    end if;
  end loop;
  if v_manual_count>0 and v_catalog='[]'::jsonb and not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Manual pricing is not permitted' using errcode='42501'; end if;
  if v_catalog='[]'::jsonb and v_manual_total<=0 then raise exception 'Zero-value orders require the established complimentary-order workflow' using errcode='22023'; end if;
  if v_manual_total>=2147483647 then raise exception 'Order total exceeds the supported limit' using errcode='22023'; end if;

  if v_catalog<>'[]'::jsonb then
    v_result:=public.club_management_create_order_secure(p_organisation_id,p_location_id,p_customer_id,v_catalog,p_idempotency_key);
    select * into v_order from public.club_orders o where o.id=(v_result->'order'->>'id')::uuid and o.organisation_id=p_organisation_id for update;
    if not found then raise exception 'Created order could not be locked' using errcode='P0002'; end if;
    v_replayed:=coalesce((v_result->>'replayed')::boolean,false);
    if v_replayed then return v_result; end if;
  else
    insert into public.club_orders(organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_by,idempotency_key)
      values(p_organisation_id,p_location_id,p_customer_id,null,'staff_checkout','draft','GBP',0,0,0,auth.uid(),p_idempotency_key) returning * into v_order;
  end if;

  if v_manual_count>0 and (v_order.subtotal_minor::numeric+v_manual_total>2147483647 or v_order.total_minor::numeric+v_manual_total>2147483647) then raise exception 'Combined order total exceeds the supported limit' using errcode='22003'; end if;
  if v_manual_count>0 then
    for v_line in select value from jsonb_array_elements(p_items) where coalesce(value->>'kind','catalogue') in ('manual_service','manual_physical') loop
      v_kind:=v_line->>'kind'; v_qty:=(v_line->>'quantity')::integer; v_price:=(v_line->>'unit_price_minor')::numeric; v_description:=btrim(v_line->>'description'); v_notes:=nullif(btrim(v_line->>'notes'),'');
      v_stock_id:=case when v_kind='manual_physical' and nullif(v_line->>'stock_product_id','') is not null then (v_line->>'stock_product_id')::uuid else null end;
      insert into public.club_order_items(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked,line_kind,manual_notes)
        values(v_order.id,p_organisation_id,v_stock_id,left(v_description,160),null,v_qty,v_price::integer,(v_price*v_qty)::integer,v_stock_id is not null,v_kind,v_notes);
    end loop;
    update public.club_orders set subtotal_minor=subtotal_minor+v_manual_total::integer,total_minor=total_minor+v_manual_total::integer,updated_at=now()
      where id=v_order.id and organisation_id=p_organisation_id returning * into v_order;
    select m.role into v_role from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active limit 1;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
      values(p_organisation_id,auth.uid(),v_role,'commerce.management_manual_lines_added','order',v_order.id,p_location_id,jsonb_build_object('lines',v_manual_audit,'total_minor',v_order.total_minor,'currency','GBP'));
  end if;
  return jsonb_build_object('order',jsonb_build_object('id',v_order.id,'organisation_id',v_order.organisation_id,'location_id',v_order.location_id,'customer_id',v_order.customer_id,'status',v_order.status,'currency',v_order.currency,'subtotal_minor',v_order.subtotal_minor,'discount_minor',v_order.discount_minor,'total_minor',v_order.total_minor,'created_at',v_order.created_at),'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_name',i.product_name,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor,'line_kind',i.line_kind,'manual_notes',i.manual_notes) order by i.created_at,i.id) from public.club_order_items i where i.order_id=v_order.id and i.organisation_id=p_organisation_id),'[]'::jsonb),'replayed',v_replayed);
end $$;

revoke all on function public.club_management_create_order_with_manual_lines_secure(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.club_management_create_order_with_manual_lines_secure(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;

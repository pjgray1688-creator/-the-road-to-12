-- Local Madhouse POS units and PT service-package credit foundation.
-- Additive, organisation-scoped and review-only; do not apply from the app.

alter table public.club_commerce_products
  add column if not exists sales_channels text[] not null default array['pos','online']::text[],
  add column if not exists unit_label text not null default 'unit',
  add column if not exists source_product_id uuid,
  add column if not exists units_per_source integer,
  add column if not exists service_credit_quantity integer,
  add column if not exists service_validity_days integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='club_commerce_products_source_org_fk') then
    alter table public.club_commerce_products add constraint club_commerce_products_source_org_fk
      foreign key (source_product_id, organisation_id) references public.club_commerce_products(id, organisation_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='club_commerce_products_source_unit_check') then
    alter table public.club_commerce_products add constraint club_commerce_products_source_unit_check
      check ((source_product_id is null and units_per_source is null) or (source_product_id is not null and source_product_id<>id and units_per_source>0));
  end if;
  if not exists (select 1 from pg_constraint where conname='club_commerce_products_channels_check') then
    alter table public.club_commerce_products add constraint club_commerce_products_channels_check
      check (cardinality(sales_channels)>0 and sales_channels <@ array['pos','online']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname='club_commerce_products_service_credit_check') then
    alter table public.club_commerce_products add constraint club_commerce_products_service_credit_check
      check ((service_credit_quantity is null or (service_credit_quantity>0 and service_id is not null and not stock_tracked)) and (service_validity_days is null or service_validity_days>0));
  end if;
end $$;
create index if not exists club_commerce_products_source_product_idx on public.club_commerce_products(organisation_id,source_product_id) where source_product_id is not null;

alter table public.club_services
  add column if not exists package_credit_quantity integer,
  add column if not exists package_validity_days integer;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='club_services_package_credit_check') then
    alter table public.club_services add constraint club_services_package_credit_check
      check ((package_credit_quantity is null or package_credit_quantity>0) and (package_validity_days is null or package_validity_days>0));
  end if;
end $$;

-- Keep the existing commerce save contract and its organisation/role checks;
-- this wrapper adds channel/unit metadata and optionally links a service row.
create or replace function public.club_save_pos_product(
  p_id uuid,p_organisation_id uuid,p_sku text,p_barcode text,p_name text,p_brand text,p_description text,p_category text,
  p_active boolean,p_stock_tracked boolean,p_sell_price_minor integer,p_cost_price_minor integer,p_currency text,p_tax_code text,
  p_supplier_reference text,p_media jsonb,p_sales_channels text[],p_unit_label text,p_source_product_id uuid,p_units_per_source integer,
  p_service_product boolean,p_service_credit_quantity integer,p_service_validity_days integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved jsonb; product_id uuid; service_id uuid; result jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then
    raise exception 'Commerce catalogue administration is not permitted' using errcode='42501';
  end if;
  if coalesce(cardinality(p_sales_channels),0)=0 or not (p_sales_channels <@ array['pos','online']::text[])
    or nullif(btrim(p_unit_label),'') is null or length(btrim(p_unit_label))>40
    or (p_source_product_id is null)<>(p_units_per_source is null) or coalesce(p_units_per_source,1)<1
    or p_service_product and p_stock_tracked
    or p_service_credit_quantity is not null and (not p_service_product or p_service_credit_quantity<1)
    or p_service_validity_days is not null and p_service_validity_days<1 then
    raise exception 'Invalid sellable unit or service configuration' using errcode='22023';
  end if;
  if p_source_product_id is not null and not exists(select 1 from public.club_commerce_products where id=p_source_product_id and organisation_id=p_organisation_id) then
    raise exception 'Source product must belong to this organisation' using errcode='22023';
  end if;
  saved:=public.club_save_commerce_product(p_id,p_organisation_id,p_sku,p_barcode,p_name,p_brand,p_description,p_category,p_active,p_stock_tracked,p_sell_price_minor,p_cost_price_minor,p_currency,p_tax_code,p_supplier_reference,p_media);
  product_id:=(saved->>'id')::uuid;
  if p_service_product then
    select cp.service_id into service_id from public.club_commerce_products cp where cp.id=product_id and cp.organisation_id=p_organisation_id for update;
    if service_id is null then
      insert into public.club_services(organisation_id,name,category,price_minor,currency,active,package_credit_quantity,package_validity_days)
      values(p_organisation_id,btrim(p_name),coalesce(nullif(btrim(p_category),''),'PT'),p_sell_price_minor,p_currency,p_active,p_service_credit_quantity,p_service_validity_days)
      returning id into service_id;
    else
      update public.club_services set name=btrim(p_name),category=coalesce(nullif(btrim(p_category),''),'PT'),price_minor=p_sell_price_minor,currency=p_currency,active=p_active,
        package_credit_quantity=p_service_credit_quantity,package_validity_days=p_service_validity_days,updated_at=now()
      where id=service_id and organisation_id=p_organisation_id;
    end if;
  else
    service_id:=null;
  end if;
  update public.club_commerce_products set sales_channels=p_sales_channels,unit_label=btrim(p_unit_label),source_product_id=p_source_product_id,
    units_per_source=p_units_per_source,service_id=case when p_service_product then service_id else null end,
    service_credit_quantity=case when p_service_product then p_service_credit_quantity else null end,
    service_validity_days=case when p_service_product then p_service_validity_days else null end,updated_at=now()
  where id=product_id and organisation_id=p_organisation_id returning to_jsonb(club_commerce_products.*) into result;
  return result;
end; $$;
revoke all on function public.club_save_pos_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb,text[],text,uuid,integer,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.club_save_pos_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb,text[],text,uuid,integer,boolean,integer,integer) to authenticated;

-- Enforce channel eligibility inside the canonical order-item write path.
create or replace function public.club_validate_commerce_order_item_channel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare order_channel text; channels text[];
begin
  select o.channel,p.sales_channels into order_channel,channels
  from public.club_orders o join public.club_commerce_products p on p.id=new.product_id and p.organisation_id=new.organisation_id
  where o.id=new.order_id and o.organisation_id=new.organisation_id and p.active;
  if order_channel is null or channels is null
    or (order_channel in ('staff_checkout','quick_sale') and not ('pos'=any(channels)))
    or (order_channel not in ('staff_checkout','quick_sale') and not ('online'=any(channels))) then
    raise exception 'Product is not available in this sales channel' using errcode='22023';
  end if;
  return new;
end; $$;
drop trigger if exists club_order_item_sales_channel on public.club_order_items;
create trigger club_order_item_sales_channel before insert or update of product_id,order_id,organisation_id on public.club_order_items
for each row execute function public.club_validate_commerce_order_item_channel();

-- Serialize inventory withdrawals/counts with checkout reservations so neither
-- manual adjustment nor shelf removal can consume stock already promised to a basket.
create or replace function public.club_adjust_inventory(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_movement_type text,p_quantity_delta integer,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_stock_movements%rowtype; v_existing public.club_stock_movements%rowtype; on_hand integer; reserved integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Inventory adjustment is not permitted' using errcode='42501'; end if;
  if p_quantity_delta=0 or p_movement_type not in ('delivery','transfer_in','transfer_out','return','waste','damage','complimentary','stocktake_adjustment','manual_adjustment') or nullif(btrim(p_reason),'') is null then raise exception 'Invalid inventory movement' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_stock_movements where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not exists(select 1 from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id and active and stock_tracked) then raise exception 'Stock location or product is unavailable' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_location_id::text||':'||p_product_id::text,0));
  select coalesce(sum(quantity_delta),0) into on_hand from public.club_stock_movements where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id;
  select coalesce(sum(quantity),0) into reserved from public.club_stock_reservations where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id and status='active';
  if p_quantity_delta<0 and on_hand+p_quantity_delta<reserved then raise exception 'Adjustment would use stock reserved for checkout' using errcode='23514'; end if;
  if not exists(select 1 from public.club_inventory where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id) then insert into public.club_inventory(organisation_id,location_id,product_id) values(p_organisation_id,p_location_id,p_product_id); end if;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id,idempotency_key)
  values(p_organisation_id,p_location_id,p_product_id,p_movement_type,p_quantity_delta,p_reason,auth.uid(),p_idempotency_key) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_record_stock_removal(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_quantity integer,p_reason text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare product public.club_commerce_products%rowtype; r public.club_stock_removals%rowtype; existing public.club_stock_removals%rowtype; on_hand integer; reserved integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.stock_remove') then raise exception 'Stock removal is not permitted' using errcode='42501'; end if;
  if p_quantity<1 or p_reason not in ('staff_consumption','complimentary','promotion_sample','damaged','waste','other') or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Invalid stock removal' using errcode='22023'; end if;
  select * into existing from public.club_stock_removals where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(existing); end if;
  select * into product from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id and active and stock_tracked for share; if not found then raise exception 'Stock product is unavailable' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Stock location is unavailable' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_location_id::text||':'||p_product_id::text,0));
  select coalesce(sum(quantity_delta),0) into on_hand from public.club_stock_movements where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id;
  select coalesce(sum(quantity),0) into reserved from public.club_stock_reservations where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id and status='active';
  if on_hand-reserved<p_quantity then raise exception 'Insufficient free stock' using errcode='22003'; end if;
  insert into public.club_stock_removals(organisation_id,location_id,product_id,quantity,reason,note,retail_unit_price_minor,cost_unit_minor,actor_user_id,authorising_user_id,idempotency_key)
  values(p_organisation_id,p_location_id,p_product_id,p_quantity,p_reason,p_note,product.sell_price_minor,product.cost_price_minor,auth.uid(),auth.uid(),p_idempotency_key) returning * into r;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id,idempotency_key)
  values(p_organisation_id,p_location_id,p_product_id,case when p_reason in ('complimentary','promotion_sample') then 'complimentary' when p_reason in ('damaged','waste') then 'waste' else 'manual_adjustment' end,-p_quantity,'stock_removal:'||p_reason,auth.uid(),'removal:'||r.id::text)
  on conflict(organisation_id,idempotency_key) do nothing;
  return to_jsonb(r);
end; $$;

-- Package credits are issued only when the existing paid service transaction is
-- created. Its unique order-item link plus lot idempotency key prevents replay.
create or replace function public.club_grant_purchased_service_package() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare svc public.club_services%rowtype; member_user uuid; item_id uuid; order_ref text; lot_key text;
begin
  select * into svc from public.club_services where id=new.service_id and organisation_id=new.organisation_id;
  if not found or svc.package_credit_quantity is null then return new; end if;
  if new.payment_status not in ('paid','waived') or new.customer_id is null then
    raise exception 'A linked customer and completed payment are required for PT package credits' using errcode='22023';
  end if;
  select user_id into member_user from public.club_customers where id=new.customer_id and organisation_id=new.organisation_id;
  item_id:=new.commerce_order_item_id;
  lot_key:='pt-package:'||coalesce(item_id::text,new.id::text);
  insert into public.club_service_credit_lots(organisation_id,user_id,customer_id,credit_key,unit,original_quantity,remaining_quantity,
    expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
  values(new.organisation_id,member_user,new.customer_id,'pt_sessions:'||svc.id::text,'session',svc.package_credit_quantity*new.quantity,
    svc.package_credit_quantity*new.quantity,case when svc.package_validity_days is null then null else now()+make_interval(days=>svc.package_validity_days) end,
    'purchased',coalesce(item_id::text,new.id::text),new.location_id,new.staff_user_id,lot_key)
  on conflict (organisation_id,idempotency_key) do nothing;
  return new;
end; $$;
drop trigger if exists club_service_transaction_pt_package_grant on public.club_service_transactions;
create trigger club_service_transaction_pt_package_grant after insert on public.club_service_transactions
for each row execute function public.club_grant_purchased_service_package();

-- Self-read is deliberately tied to the user's own canonical customer link;
-- staff access remains as existing policy. The service-credit lot remains the
-- durable, append-only purchase record and is separate from access entitlements.
drop policy if exists glow_lots_self_staff on public.club_service_credit_lots;
create policy glow_lots_self_staff on public.club_service_credit_lots for select to authenticated
using (user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=customer_id and c.organisation_id=club_service_credit_lots.organisation_id and c.user_id=auth.uid())
  or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));

create or replace function public.club_list_my_pt_package_balances(p_organisation_id uuid)
returns table(credit_key text,remaining_quantity bigint,expires_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not (exists(select 1 from public.club_customers c where c.organisation_id=p_organisation_id and c.user_id=auth.uid())
    or public.club_has_active_role(p_organisation_id,array['member'])) then
    raise exception 'PT package balance is not available' using errcode='42501';
  end if;
  return query select l.credit_key,sum(l.remaining_quantity)::bigint,min(l.expires_at)
    from public.club_service_credit_lots l
    where l.organisation_id=p_organisation_id and l.remaining_quantity>0
      and l.credit_key like 'pt_sessions:%' and (l.expires_at is null or l.expires_at>now())
      and (l.user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=l.customer_id and c.organisation_id=p_organisation_id and c.user_id=auth.uid()))
    group by l.credit_key,l.expires_at;
end; $$;
revoke all on function public.club_list_my_pt_package_balances(uuid) from public,anon,authenticated;
grant execute on function public.club_list_my_pt_package_balances(uuid) to authenticated;

create or replace function public.club_list_coach_client_pt_package_balances(p_organisation_id uuid,p_client_user_id uuid)
returns table(credit_key text,remaining_quantity bigint,expires_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.coach_client_assignments a
    join public.coach_permissions cp on cp.organisation_id=a.organisation_id and cp.user_id=auth.uid() and cp.active
    join public.club_members m on m.organisation_id=a.organisation_id and m.user_id=auth.uid() and m.active and m.role='trainer'
    where a.organisation_id=p_organisation_id and a.coach_user_id=auth.uid() and a.client_user_id=p_client_user_id and a.active
  ) then raise exception 'Coach client package balance is not available' using errcode='42501'; end if;
  return query select l.credit_key,sum(l.remaining_quantity)::bigint,l.expires_at
    from public.club_service_credit_lots l
    join public.club_customers c on c.id=l.customer_id and c.organisation_id=l.organisation_id and c.user_id=p_client_user_id
    where l.organisation_id=p_organisation_id and l.remaining_quantity>0 and l.credit_key like 'pt_sessions:%'
      and (l.expires_at is null or l.expires_at>now())
    group by l.credit_key,l.expires_at;
end; $$;
revoke all on function public.club_list_coach_client_pt_package_balances(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_list_coach_client_pt_package_balances(uuid,uuid) to authenticated;

revoke all on function public.club_validate_commerce_order_item_channel(),public.club_grant_purchased_service_package() from public,anon,authenticated;


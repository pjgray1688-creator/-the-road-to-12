-- Additive guest Website Apparel order lifecycle. No member-shop prices or
-- inventory are modified. Apply after the Website Shop controls and Stripe
-- commerce foundation migrations have been deployed.
alter table public.club_order_items
  add column if not exists website_public_slug text,
  add column if not exists variant_colour text,
  add column if not exists variant_size text,
  add column if not exists discount_quantity integer not null default 0 check(discount_quantity>=0),
  add column if not exists discount_minor integer not null default 0 check (discount_minor >= 0);

-- Public made-to-order apparel is not a stock sale or a Club supplier
-- collection order. Keep the existing supplier workflow for all other items,
-- while excluding only immutable website apparel snapshots.
create or replace function public.club_create_supplier_demand_for_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order record; v_item record; v_offer record; v_count integer:=0;
begin
  select o.* into v_order from public.club_orders o where o.id=p_order_id and o.status in ('paid','fulfilled');
  if not found then return 0; end if;
  for v_item in select i.* from public.club_order_items i where i.order_id=p_order_id and i.website_public_slug is null loop
    select count(*) into v_count from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection';
    if v_count <> 1 then continue; end if;
    select sp.* into v_offer from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection' limit 1;
    insert into public.club_supplier_demand(organisation_id,supplier_id,supplier_product_id,order_id,order_item_id,user_id,collection_location_id,quantity_required)
      values(v_order.organisation_id,v_offer.supplier_id,v_offer.id,v_order.id,v_item.id,v_order.user_id,v_order.location_id,v_item.quantity)
      on conflict (order_item_id) do nothing;
  end loop;
  return 1;
end; $$;
revoke all on function public.club_create_supplier_demand_for_order(uuid) from public,anon,authenticated;

create sequence if not exists public.club_madhouse_apparel_order_number_seq;

create table if not exists public.club_madhouse_apparel_order_details (
  order_id uuid primary key references public.club_orders(id) on delete restrict,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_number text not null unique,
  customer_first_name text not null,
  customer_surname text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_address jsonb not null check (jsonb_typeof(delivery_address)='object'),
  billing_address jsonb not null check (jsonb_typeof(billing_address)='object'),
  billing_same_as_delivery boolean not null,
  delivery_minor integer not null default 395 check (delivery_minor=395),
  confirmation_token_hash text not null unique,
  stripe_checkout_session_id text unique,
  courier text,
  tracking_number text,
  tracking_url text,
  fulfilment_status text not null default 'payment_pending'
    check (fulfilment_status in ('payment_pending','new_order','in_production','ready_to_dispatch','dispatched','delivered','cancelled','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(order_id,organisation_id) references public.club_orders(id,organisation_id) on delete restrict
);

create table if not exists public.club_madhouse_apparel_order_activity (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.club_madhouse_apparel_order_details(order_id) on delete restrict,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  activity_type text not null,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.club_madhouse_apparel_email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.club_madhouse_apparel_order_details(order_id) on delete restrict,
  event_key text not null,
  recipient_email text not null,
  subject text not null,
  html_body text not null,
  text_body text not null,
  template_key text not null default 'order_confirmed',
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check(attempts>=0),
  state text not null default 'queued' check(state in ('queued','sending','sent','failed','suppressed')),
  provider_reference text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(order_id,event_key,recipient_email)
);

alter table public.club_madhouse_apparel_order_details enable row level security;
alter table public.club_madhouse_apparel_order_activity enable row level security;
alter table public.club_madhouse_apparel_email_outbox enable row level security;
revoke all on public.club_madhouse_apparel_order_details, public.club_madhouse_apparel_order_activity,
  public.club_madhouse_apparel_email_outbox from public,anon,authenticated;
grant usage,select on sequence public.club_madhouse_apparel_order_number_seq to service_role;
grant all on public.club_madhouse_apparel_order_details, public.club_madhouse_apparel_order_activity,
  public.club_madhouse_apparel_email_outbox to service_role;

create or replace function public.club_prepare_madhouse_apparel_checkout(p_payload jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  line jsonb; pub public.club_website_shop_publications%rowtype; prod public.club_commerce_products%rowtype;
  order_row public.club_orders%rowtype; attempt public.club_payment_attempts%rowtype;
  detail public.club_madhouse_apparel_order_details%rowtype; existing public.club_orders%rowtype;
  subtotal integer:=0; discount integer:=0; total integer; qty integer; price integer;
  line_data jsonb:='[]'::jsonb; order_no text; token_hash text; confirmation_token text; slug text; sz text; idx integer;
  first_name text; surname text; email text; phone text; same_billing boolean;
  shipping jsonb; billing jsonb; hoodie_count integer:=0; tee_count integer:=0;
  promo record; hood_group jsonb; tee_group jsonb; pair_count integer:=0; tee_unit integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Guest apparel checkout requires trusted server access' using errcode='42501'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$'
    or jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'items')<>'array'
    or jsonb_array_length(p_payload->'items')<1 or jsonb_array_length(p_payload->'items')>30 then
    raise exception 'Checkout request is invalid' using errcode='22023';
  end if;
  first_name:=nullif(btrim(p_payload->'customer'->>'firstName'),'');
  surname:=nullif(btrim(p_payload->'customer'->>'surname'),'');
  email:=lower(nullif(btrim(p_payload->'customer'->>'email'),''));
  phone:=nullif(btrim(p_payload->'customer'->>'phone'),'');
  same_billing:=coalesce((p_payload->>'billingSameAsDelivery')::boolean,true);
  shipping:=p_payload->'deliveryAddress';
  billing:=case when same_billing then shipping else p_payload->'billingAddress' end;
  if first_name is null or length(first_name)>100 or surname is null or length(surname)>100
    or email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or phone is null or length(phone)>40 or jsonb_typeof(shipping) is distinct from 'object' or jsonb_typeof(billing) is distinct from 'object'
    or upper(coalesce(shipping->>'country','GB'))<>'GB' or upper(coalesce(billing->>'country','GB'))<>'GB'
    or nullif(btrim(shipping->>'line1'),'') is null or nullif(btrim(shipping->>'town'),'') is null or nullif(btrim(shipping->>'postcode'),'') is null
    or nullif(btrim(billing->>'line1'),'') is null or nullif(btrim(billing->>'town'),'') is null or nullif(btrim(billing->>'postcode'),'') is null then
    raise exception 'Customer or UK delivery details are invalid' using errcode='22023';
  end if;

  select * into existing from public.club_orders where organisation_id=org and idempotency_key=p_idempotency_key;
  if found then
    select * into detail from public.club_madhouse_apparel_order_details where order_id=existing.id;
    select * into attempt from public.club_payment_attempts where order_id=existing.id and organisation_id=org;
    return jsonb_build_object('order_id',existing.id,'attempt_id',attempt.id,'order_number',detail.order_number,
      'total_minor',existing.total_minor,'subtotal_minor',existing.subtotal_minor,'discount_minor',existing.discount_minor,
      'delivery_minor',detail.delivery_minor,'confirmation_token',null,'replayed',true,
      'lines',(select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_name',i.product_name,'colour',i.variant_colour,'size',i.variant_size,'quantity',i.quantity,'discount_quantity',i.discount_quantity,'unit_price_minor',i.unit_price_minor,'currency',existing.currency) order by i.id),'[]'::jsonb) from public.club_order_items i where i.order_id=existing.id));
  end if;

  for line in select value from jsonb_array_elements(p_payload->'items') loop
    slug:=line->>'productId'; sz:=line->>'size'; qty:=case when (line->>'quantity') ~ '^\d+$' then (line->>'quantity')::integer else 0 end;
    if qty<1 or qty>20 or sz not in ('S','M','L','XL','2XL','3XL','4XL','5XL') then raise exception 'Basket quantity or size is invalid' using errcode='22023'; end if;
    select w.* into pub from public.club_website_shop_publications w
      join public.club_product_families f on f.id=w.family_id and f.organisation_id=w.organisation_id and f.active and f.archived_at is null
      left join public.club_website_shop_family_settings fs on fs.organisation_id=w.organisation_id and fs.family_id=w.family_id
      where w.organisation_id=org and w.public_slug=slug and w.published and w.available and w.mapping_verified and coalesce(fs.visible,true)
        and w.website_available_sizes @> array[sz]::text[];
    if not found then raise exception 'A garment or selected size is no longer available' using errcode='22023'; end if;
    select p.* into prod from public.club_commerce_products p where p.organisation_id=org and p.family_id=pub.family_id
      and p.variant_options->>'colour'=pub.variant_colour and p.variant_options->>'size'=sz and p.active for share;
    if not found then raise exception 'A garment or selected size is no longer available' using errcode='22023'; end if;
    if pub.website_price_minor is not null then price:=pub.website_price_minor;
    else
      select case when count(*)=8 and count(distinct sell_price_minor)=1 and min(sell_price_minor)>0 then min(sell_price_minor) end
        into price from public.club_commerce_products where organisation_id=org and family_id=pub.family_id and variant_options->>'colour'=pub.variant_colour and active;
    end if;
    if price is null or price<1 then raise exception 'Website price is not configured for a selected garment' using errcode='22023'; end if;
    subtotal:=subtotal+price*qty;
    if pub.family_id='912a3ec3-c8cc-48c0-9d20-9223584d0714' then hoodie_count:=hoodie_count+qty; end if;
    if pub.family_id='fccc70d5-2db2-45ab-be4f-3cd728c28aa8' then tee_count:=tee_count+qty; tee_unit:=price; end if;
    line_data:=line_data||jsonb_build_array(jsonb_build_object('slug',slug,'product_id',prod.id,'name',pub.display_name,'colour',pub.public_colour,'size',sz,'quantity',qty,'price',price,'family_id',pub.family_id,'discount_quantity',0));
  end loop;

  if hoodie_count>0 and tee_count>0 then
  select p.eligibility into promo from public.club_promotions p where p.organisation_id=org and p.status='active'
      and now()>=p.starts_at and (p.ends_at is null or now()<p.ends_at)
      and cardinality(coalesce(p.location_ids,'{}'::uuid[]))=0
      and p.eligibility ? 'bundle_groups' and p.eligibility ? 'bundle_price_minor'
      and p.name ilike '%hoodie%t-shirt%' order by coalesce((p.eligibility->>'priority')::integer,0) desc limit 1;
    if not found then raise exception 'The current R12 hoodie and T-shirt promotion cannot be verified' using errcode='22023'; end if;
    pair_count:=least(hoodie_count,tee_count);
    if not coalesce((promo.eligibility->>'repeatable')::boolean,true) then pair_count:=least(pair_count,1); end if;
    select value into hood_group from jsonb_array_elements(promo.eligibility->'bundle_groups') where value->>'group_id'='hoodie' limit 1;
    select value into tee_group from jsonb_array_elements(promo.eligibility->'bundle_groups') where value->>'group_id'='tshirt' limit 1;
    if hood_group is null or tee_group is null then raise exception 'The current R12 apparel promotion is not configured for the mapped products' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(line_data) x where (x->>'family_id')='912a3ec3-c8cc-48c0-9d20-9223584d0714' and not ((hood_group->'product_ids') ? (x->>'product_id'))) or
       exists(select 1 from jsonb_array_elements(line_data) x where (x->>'family_id')='fccc70d5-2db2-45ab-be4f-3cd728c28aa8' and not ((tee_group->'product_ids') ? (x->>'product_id'))) then
      raise exception 'Promotion eligibility does not match the published R12 products' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(line_data) h cross join jsonb_array_elements(line_data) t
      where (h->>'family_id')='912a3ec3-c8cc-48c0-9d20-9223584d0714' and ((hood_group->'product_ids') ? (h->>'product_id'))
        and (t->>'family_id')='fccc70d5-2db2-45ab-be4f-3cd728c28aa8' and ((tee_group->'product_ids') ? (t->>'product_id'))
        and (h->>'price')::integer+(t->>'price')::integer-floor((t->>'price')::numeric/2)::integer<>(promo.eligibility->>'bundle_price_minor')::integer) then
      raise exception 'The R12 bundle price does not match current website prices; checkout cannot safely apply the offer' using errcode='22023';
    end if;
    -- The R12 configured bundle groups determine eligible variants and
    -- repeatability. The half-price benefit is applied to eligible tee units.
    declare eligible_left integer:=pair_count; tee_line jsonb; tee_discount integer; discounted_qty integer; begin
      for idx in 0..jsonb_array_length(line_data)-1 loop
        tee_line:=line_data->idx;
        if (tee_line->>'family_id')='fccc70d5-2db2-45ab-be4f-3cd728c28aa8'
          and ((tee_group->'product_ids') ? (tee_line->>'product_id')) and eligible_left>0 then
          discounted_qty:=least(eligible_left,(tee_line->>'quantity')::integer);
          tee_discount:=floor((tee_line->>'price')::numeric/2)::integer;
          discount:=discount+discounted_qty*tee_discount; eligible_left:=eligible_left-discounted_qty;
          line_data:=jsonb_set(line_data,ARRAY[idx::text,'discount_quantity'],to_jsonb(discounted_qty));
        end if;
      end loop;
    end;
  end if;
  total:=subtotal-discount+395;
  if total<=0 then raise exception 'Checkout total is invalid' using errcode='22023'; end if;

  order_no:='MH-'||to_char(now() at time zone 'UTC','YYYY')||'-'||lpad(nextval('public.club_madhouse_apparel_order_number_seq')::text,6,'0');
  confirmation_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  token_hash:=encode(digest(confirmation_token,'sha256'),'hex');
  insert into public.club_orders(organisation_id,location_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,idempotency_key)
    values(org,null,'web','pending_payment','GBP',subtotal,discount,total,p_idempotency_key) returning * into order_row;
  for line in select value from jsonb_array_elements(line_data) loop
    insert into public.club_order_items(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked,website_public_slug,variant_colour,variant_size,discount_quantity,discount_minor)
      select order_row.id,org,p.id,p.name,p.sku,(line->>'quantity')::integer,(line->>'price')::integer,(line->>'quantity')::integer*(line->>'price')::integer,false,line->>'slug',line->>'colour',line->>'size',
        (line->>'discount_quantity')::integer,((line->>'discount_quantity')::integer*floor((line->>'price')::numeric/2)::integer)
      from public.club_commerce_products p where p.id=(line->>'product_id')::uuid and p.organisation_id=org;
  end loop;
  insert into public.club_madhouse_apparel_order_details(order_id,organisation_id,order_number,customer_first_name,customer_surname,customer_email,customer_phone,delivery_address,billing_address,billing_same_as_delivery,confirmation_token_hash)
    values(order_row.id,org,order_no,first_name,surname,email,phone,shipping,billing,same_billing,token_hash) returning * into detail;
  insert into public.club_payment_attempts(organisation_id,order_id,status,external_method,total_minor,balance_amount_minor,external_amount_minor,idempotency_key,stripe_merchant_entity)
    values(org,order_row.id,'pending','card',total,0,total,p_idempotency_key||':apparel','madhouse_products_services') returning * into attempt;
  insert into public.club_madhouse_apparel_order_activity(order_id,organisation_id,activity_type,to_status,details)
    values(order_row.id,org,'checkout_created','payment_pending',jsonb_build_object('source','public_website'));
  return jsonb_build_object('order_id',order_row.id,'attempt_id',attempt.id,'order_number',order_no,'total_minor',total,
    'subtotal_minor',subtotal,'discount_minor',discount,'delivery_minor',395,'confirmation_token',confirmation_token,
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'product_name',p.name,'colour',i.variant_colour,'size',i.variant_size,'quantity',i.quantity,'discount_quantity',i.discount_quantity,'unit_price_minor',i.unit_price_minor,'currency','GBP') order by i.id),'[]'::jsonb) from public.club_order_items i join public.club_commerce_products p on p.id=i.product_id where i.order_id=order_row.id));
end; $$;
revoke all on function public.club_prepare_madhouse_apparel_checkout(jsonb,text) from public,anon,authenticated;
grant execute on function public.club_prepare_madhouse_apparel_checkout(jsonb,text) to service_role;

create or replace function public.club_set_madhouse_apparel_session(p_attempt_id uuid,p_session_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' or p_session_id !~ '^cs_' then raise exception 'Checkout session update is not permitted' using errcode='42501'; end if;
  update public.club_payment_attempts set stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_session_id),updated_at=now()
    where id=p_attempt_id and stripe_merchant_entity='madhouse_products_services' and status='pending'
      and (stripe_checkout_session_id is null or stripe_checkout_session_id=p_session_id);
  if not found then raise exception 'Pending apparel payment attempt was not found' using errcode='P0002'; end if;
  update public.club_madhouse_apparel_order_details d set stripe_checkout_session_id=p_session_id,updated_at=now()
    from public.club_payment_attempts a where a.id=p_attempt_id and d.order_id=a.order_id and d.organisation_id=a.organisation_id;
end; $$;
revoke all on function public.club_set_madhouse_apparel_session(uuid,text) from public,anon,authenticated;
grant execute on function public.club_set_madhouse_apparel_session(uuid,text) to service_role;

create or replace function public.club_mark_madhouse_apparel_paid(p_attempt_id uuid,p_event_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; d public.club_madhouse_apparel_order_details%rowtype; o public.club_orders%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Payment confirmation is not permitted' using errcode='42501'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id and stripe_merchant_entity='madhouse_products_services' for update;
  if not found or a.status<>'paid' then raise exception 'Verified paid payment attempt is required' using errcode='22023'; end if;
  select * into d from public.club_madhouse_apparel_order_details where order_id=a.order_id for update;
  select * into o from public.club_orders where id=a.order_id for update;
  if d.fulfilment_status='payment_pending' then
    update public.club_madhouse_apparel_order_details set fulfilment_status='new_order',updated_at=now() where order_id=d.order_id returning * into d;
    insert into public.club_madhouse_apparel_order_activity(order_id,organisation_id,activity_type,from_status,to_status,details)
      values(d.order_id,d.organisation_id,'payment_confirmed','payment_pending','new_order',jsonb_build_object('stripe_event_id',p_event_id));
    insert into public.club_madhouse_apparel_email_outbox(order_id,event_key,recipient_email,subject,html_body,text_body,state)
      values(d.order_id,'customer_order_confirmed',d.customer_email,'Madhouse Apparel order confirmed','', '', 'queued')
      on conflict(order_id,event_key,recipient_email) do nothing;
    update public.club_madhouse_apparel_email_outbox set template_key='order_confirmed',payload=jsonb_build_object('order_id',d.order_id,'order_number',d.order_number)
      where order_id=d.order_id and event_key='customer_order_confirmed' and recipient_email=d.customer_email;
    insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,state,payload)
      select d.organisation_id,m.user_id,'madhouse_apparel_new_order',d.order_id,'queued',jsonb_build_object('order_number',d.order_number,'total_minor',o.total_minor)
      from public.club_members m where m.organisation_id=d.organisation_id and m.active and m.role in ('gym_staff','gym_admin','owner')
      on conflict do nothing;
  end if;
  return jsonb_build_object('order_id',o.id,'order_number',d.order_number,'duplicate',d.fulfilment_status<>'new_order');
end; $$;
revoke all on function public.club_mark_madhouse_apparel_paid(uuid,text) from public,anon,authenticated;
grant execute on function public.club_mark_madhouse_apparel_paid(uuid,text) to service_role;

create or replace function public.club_get_madhouse_apparel_order_confirmation(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d public.club_madhouse_apparel_order_details%rowtype; o public.club_orders%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into d from public.club_madhouse_apparel_order_details where confirmation_token_hash=p_token_hash;
  if not found then return null; end if;
  select * into o from public.club_orders where id=d.order_id;
  if o.status not in ('paid','fulfilled') then return jsonb_build_object('paid',false); end if;
  return jsonb_build_object('paid',true,'order_number',d.order_number,'customer_first_name',d.customer_first_name,
    'email',d.customer_email,'delivery_address',d.delivery_address,'subtotal_minor',o.subtotal_minor,
    'discount_minor',o.discount_minor,'delivery_minor',d.delivery_minor,'total_minor',o.total_minor,'currency',o.currency,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'colour',i.variant_colour,'size',i.variant_size,
      'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor) order by i.id),'[]'::jsonb)
      from public.club_order_items i where i.order_id=o.id));
end; $$;
revoke all on function public.club_get_madhouse_apparel_order_confirmation(text) from public,authenticated;
grant execute on function public.club_get_madhouse_apparel_order_confirmation(text) to anon;

create or replace function public.club_update_madhouse_apparel_fulfilment(
  p_organisation_id uuid,p_order_id uuid,p_status text,p_courier text default null,p_tracking_number text default null,p_tracking_url text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_madhouse_apparel_order_details%rowtype; old_status text;
  order_state text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')
    or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or p_status not in ('in_production','ready_to_dispatch','dispatched','delivered','cancelled','refunded') then
    raise exception 'Apparel order management is not permitted' using errcode='42501';
  end if;
  select * into d from public.club_madhouse_apparel_order_details where order_id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or d.fulfilment_status in ('payment_pending','cancelled','refunded') then raise exception 'Apparel order cannot be updated' using errcode='22023'; end if;
  select status into order_state from public.club_orders where id=p_order_id and organisation_id=p_organisation_id;
  if p_status='refunded' and order_state<>'refunded' or p_status='cancelled' and order_state<>'cancelled' then
    raise exception 'Refund and cancellation states must be confirmed by the payment system' using errcode='22023';
  end if;
  if not ((d.fulfilment_status='new_order' and p_status in ('in_production','cancelled','refunded'))
    or (d.fulfilment_status='in_production' and p_status in ('ready_to_dispatch','cancelled','refunded'))
    or (d.fulfilment_status='ready_to_dispatch' and p_status in ('dispatched','cancelled','refunded'))
    or (d.fulfilment_status='dispatched' and p_status in ('delivered','refunded'))
    or (d.fulfilment_status='delivered' and p_status='refunded')) then
    raise exception 'Apparel fulfilment status transition is not valid' using errcode='22023';
  end if;
  if p_status='dispatched' and (nullif(btrim(p_courier),'') is null or nullif(btrim(p_tracking_number),'') is null or p_tracking_url !~ '^https://') then
    raise exception 'Courier, tracking number and secure tracking URL are required' using errcode='22023';
  end if;
  old_status:=d.fulfilment_status;
  update public.club_madhouse_apparel_order_details set fulfilment_status=p_status,courier=case when p_status='dispatched' then left(btrim(p_courier),120) else courier end,
    tracking_number=case when p_status='dispatched' then left(btrim(p_tracking_number),120) else tracking_number end,
    tracking_url=case when p_status='dispatched' then left(btrim(p_tracking_url),1000) else tracking_url end,updated_at=now()
    where order_id=p_order_id returning * into d;
  insert into public.club_madhouse_apparel_order_activity(order_id,organisation_id,actor_user_id,activity_type,from_status,to_status,details)
    values(p_order_id,p_organisation_id,auth.uid(),'fulfilment_status_changed',old_status,p_status,
      jsonb_build_object('courier',d.courier,'tracking_number',d.tracking_number,'tracking_url',d.tracking_url));
  if p_status in ('in_production','ready_to_dispatch','dispatched','delivered','cancelled','refunded') then
    insert into public.club_madhouse_apparel_email_outbox(order_id,event_key,recipient_email,subject,html_body,text_body,state)
      values(p_order_id,p_status,d.customer_email,'Madhouse Apparel order update','', '', 'queued') on conflict(order_id,event_key,recipient_email) do nothing;
    update public.club_madhouse_apparel_email_outbox set template_key=p_status,payload=jsonb_build_object('order_id',p_order_id,'order_number',d.order_number,'courier',d.courier,'tracking_number',d.tracking_number,'tracking_url',d.tracking_url)
      where order_id=p_order_id and event_key=p_status and recipient_email=d.customer_email;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),'madhouse_apparel.fulfilment_updated','commerce_order',p_order_id,jsonb_build_object('from',old_status,'to',p_status));
  return jsonb_build_object('order_id',p_order_id,'status',p_status);
end; $$;
revoke all on function public.club_update_madhouse_apparel_fulfilment(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.club_update_madhouse_apparel_fulfilment(uuid,uuid,text,text,text,text) to authenticated;

create or replace function public.club_list_madhouse_apparel_orders(p_organisation_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
    raise exception 'Apparel order access is not permitted' using errcode='42501';
  end if;
  return query select jsonb_build_object('order',to_jsonb(o),'details',to_jsonb(d)-'confirmation_token_hash',
    'items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('product_name',i.product_name) order by i.id),'[]'::jsonb) from public.club_order_items i where i.order_id=o.id),
    'payments',(select coalesce(jsonb_agg(jsonb_build_object('method',p.method,'status',p.status,'external_reference',p.external_reference,'amount_minor',p.amount_minor,'stripe_merchant_entity',p.stripe_merchant_entity,'stripe_account_id',p.stripe_account_id) order by p.created_at),'[]'::jsonb) from public.club_payments p where p.order_id=o.id),
    'activity',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]'::jsonb) from public.club_madhouse_apparel_order_activity a where a.order_id=o.id))
    from public.club_madhouse_apparel_order_details d join public.club_orders o on o.id=d.order_id
    where d.organisation_id=p_organisation_id and o.status<>'pending_payment' order by o.created_at desc;
end; $$;
revoke all on function public.club_list_madhouse_apparel_orders(uuid) from public,anon;
grant execute on function public.club_list_madhouse_apparel_orders(uuid) to authenticated;

create or replace function public.club_get_madhouse_apparel_email_context(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d public.club_madhouse_apparel_order_details%rowtype; o public.club_orders%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Apparel email context is restricted' using errcode='42501'; end if;
  select * into d from public.club_madhouse_apparel_order_details where order_id=p_order_id;
  if not found then raise exception 'Apparel order not found' using errcode='P0002'; end if;
  select * into o from public.club_orders where id=d.order_id;
  return jsonb_build_object('order',jsonb_build_object('id',o.id,'status',o.status,'subtotal_minor',o.subtotal_minor,'discount_minor',o.discount_minor,'total_minor',o.total_minor,'currency',o.currency,'created_at',o.created_at),
    'details',to_jsonb(d),'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'colour',i.variant_colour,'size',i.variant_size,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor,'discount_minor',i.discount_minor) order by i.id),'[]'::jsonb) from public.club_order_items i where i.order_id=o.id));
end; $$;
revoke all on function public.club_get_madhouse_apparel_email_context(uuid) from public,anon,authenticated;
grant execute on function public.club_get_madhouse_apparel_email_context(uuid) to service_role;

create or replace function public.club_queue_madhouse_apparel_order_alert(p_order_id uuid,p_recipients text[])
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_madhouse_apparel_order_details%rowtype; added integer;
begin
  if auth.role()<>'service_role' then raise exception 'Apparel order notification is restricted' using errcode='42501'; end if;
  select * into d from public.club_madhouse_apparel_order_details where order_id=p_order_id and fulfilment_status<>'payment_pending';
  if not found then raise exception 'Paid Apparel order not found' using errcode='P0002'; end if;
  insert into public.club_madhouse_apparel_email_outbox(order_id,event_key,recipient_email,subject,html_body,text_body,state,template_key,payload)
    select d.order_id,'manager_new_order',lower(btrim(email)),'New Madhouse Apparel order · '||d.order_number,'','', 'queued','manager_new_order',jsonb_build_object('order_id',d.order_id,'order_number',d.order_number)
    from unnest(coalesce(p_recipients,'{}'::text[])) email where lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    on conflict(order_id,event_key,recipient_email) do nothing;
  get diagnostics added=row_count;
  return added;
end; $$;
revoke all on function public.club_queue_madhouse_apparel_order_alert(uuid,text[]) from public,anon,authenticated;
grant execute on function public.club_queue_madhouse_apparel_order_alert(uuid,text[]) to service_role;

create or replace function public.club_sync_madhouse_apparel_payment_state(p_attempt_id uuid,p_event_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; o public.club_orders%rowtype; d public.club_madhouse_apparel_order_details%rowtype; next_state text;
begin
  if auth.role()<>'service_role' then raise exception 'Apparel payment state update is restricted' using errcode='42501'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id and stripe_merchant_entity='madhouse_products_services';
  if not found then raise exception 'Madhouse apparel payment attempt not found' using errcode='P0002'; end if;
  select * into o from public.club_orders where id=a.order_id;
  select * into d from public.club_madhouse_apparel_order_details where order_id=o.id for update;
  if not found then raise exception 'Madhouse apparel order not found' using errcode='P0002'; end if;
  next_state:=case when o.status='refunded' then 'refunded' when o.status='cancelled' and d.fulfilment_status='payment_pending' then 'cancelled' else d.fulfilment_status end;
  if next_state is distinct from d.fulfilment_status then
    update public.club_madhouse_apparel_order_details set fulfilment_status=next_state,updated_at=now() where order_id=o.id;
    insert into public.club_madhouse_apparel_order_activity(order_id,organisation_id,activity_type,from_status,to_status,details)
      values(o.id,d.organisation_id,'payment_status_changed',d.fulfilment_status,next_state,jsonb_build_object('stripe_event_id',p_event_id));
    if next_state='refunded' then
      insert into public.club_madhouse_apparel_email_outbox(order_id,event_key,recipient_email,subject,html_body,text_body,state,template_key,payload)
        values(o.id,'refunded',d.customer_email,'Madhouse Apparel refund · '||d.order_number,'','','queued','refunded',jsonb_build_object('order_id',o.id))
        on conflict(order_id,event_key,recipient_email) do nothing;
    end if;
  end if;
end; $$;
revoke all on function public.club_sync_madhouse_apparel_payment_state(uuid,text) from public,anon,authenticated;
grant execute on function public.club_sync_madhouse_apparel_payment_state(uuid,text) to service_role;

-- R12 Club commerce, payments and inventory foundation.
-- Forward-only and review-only: do not execute from the application.
-- Gym commerce is organisation-owned; R12 platform subscriptions are deliberately separate.

create table public.club_payment_accounts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  provider text not null check (length(btrim(provider)) > 0), purpose text not null check (length(btrim(purpose)) > 0),
  capabilities text[] not null default '{}', external_account_reference text, status text not null default 'connected' check (status in ('connected','active','paused','disconnected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id)
);

create table public.club_commerce_products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  sku text, barcode text, name text not null check (length(btrim(name)) > 0), description text, category text, active boolean not null default true,
  stock_tracked boolean not null default true, sell_price_minor integer not null check (sell_price_minor >= 0), cost_price_minor integer check (cost_price_minor >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'), tax_code text, supplier_reference text, media jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id),
  unique (organisation_id, sku), check (media is null or jsonb_typeof(media) = 'object')
);
create index club_commerce_products_org_idx on public.club_commerce_products(organisation_id, active, name);
create unique index club_commerce_products_barcode_unique on public.club_commerce_products(organisation_id, barcode) where barcode is not null;

create table public.club_inventory (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, product_id uuid not null,
  minimum_quantity integer check (minimum_quantity >= 0), target_quantity integer check (target_quantity >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organisation_id, location_id, product_id),
  foreign key (organisation_id) references public.club_organisations(id) on delete cascade,
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id),
  check (target_quantity is null or minimum_quantity is null or target_quantity >= minimum_quantity)
);

create table public.club_orders (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, location_id uuid,
  customer_id uuid, user_id uuid references auth.users(id) on delete set null, channel text not null check (channel in ('member_app','staff_checkout','quick_sale','web','other')),
  status text not null default 'draft' check (status in ('draft','pending_payment','paid','fulfilled','cancelled','refunded')),
  currency text not null check (currency ~ '^[A-Z]{3}$'), subtotal_minor integer not null check (subtotal_minor >= 0), discount_minor integer not null default 0 check (discount_minor >= 0),
  total_minor integer not null check (total_minor >= 0), created_by uuid references auth.users(id) on delete set null, idempotency_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id), unique (organisation_id, idempotency_key)
);
create index club_orders_org_created_idx on public.club_orders(organisation_id, created_at desc);
create index club_orders_customer_idx on public.club_orders(customer_id, created_at desc) where customer_id is not null;

create table public.club_order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null, organisation_id uuid not null, product_id uuid not null,
  product_name text not null, sku text, quantity integer not null check (quantity > 0), unit_price_minor integer not null check (unit_price_minor >= 0),
  line_total_minor integer not null check (line_total_minor >= 0), stock_tracked boolean not null, created_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete cascade,
  foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create index club_order_items_order_idx on public.club_order_items(order_id);

create table public.club_payments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null, organisation_id uuid not null, payment_account_id uuid,
  method text not null check (method in ('card','wallet','direct_debit','cash','bank_transfer','balance','complimentary','other')),
  external_reference text, amount_minor integer not null check (amount_minor >= 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending','paid','failed','refunded','partially_refunded','cancelled')), metadata jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete cascade,
  foreign key (payment_account_id, organisation_id) references public.club_payment_accounts(id, organisation_id), check (metadata is null or jsonb_typeof(metadata) = 'object')
);
create index club_payments_org_created_idx on public.club_payments(organisation_id, created_at desc);
create unique index club_payments_external_ref_unique on public.club_payments(organisation_id, external_reference) where external_reference is not null;

create table public.club_refunds (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null, order_id uuid not null, organisation_id uuid not null,
  amount_minor integer not null check (amount_minor > 0), reason text, external_reference text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (payment_id, organisation_id) references public.club_payments(id, organisation_id), foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id)
);

create table public.club_stock_movements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, product_id uuid not null,
  movement_type text not null check (movement_type in ('sale','delivery','transfer_in','transfer_out','return','waste','damage','complimentary','stocktake_adjustment','manual_adjustment')),
  quantity_delta integer not null check (quantity_delta <> 0), order_id uuid, reason text, actor_user_id uuid references auth.users(id) on delete set null, idempotency_key text, occurred_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id), foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id)
);
create index club_stock_movements_location_product_idx on public.club_stock_movements(organisation_id, location_id, product_id, occurred_at desc);
create unique index club_stock_movements_idempotency_unique on public.club_stock_movements(organisation_id, idempotency_key) where idempotency_key is not null;

create table public.club_balance_accounts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, customer_id uuid, user_id uuid references auth.users(id) on delete set null,
  currency text not null check (currency ~ '^[A-Z]{3}$'), status text not null default 'active' check (status in ('active','suspended','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id), unique (organisation_id, customer_id), unique (organisation_id, user_id), check (customer_id is not null or user_id is not null)
);
create table public.club_balance_entries (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, organisation_id uuid not null, entry_type text not null check (entry_type in ('top_up','purchase','refund','manual_credit','manual_debit','promotional_credit','expiry','adjustment')),
  amount_delta_minor integer not null check (amount_delta_minor <> 0), balance_after_minor integer not null check (balance_after_minor >= 0), order_id uuid, payment_id uuid, actor_user_id uuid references auth.users(id) on delete set null, reason text, idempotency_key text, created_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (account_id, organisation_id) references public.club_balance_accounts(id, organisation_id) on delete cascade,
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id), foreign key (payment_id, organisation_id) references public.club_payments(id, organisation_id)
);
create index club_balance_entries_account_created_idx on public.club_balance_entries(account_id, created_at desc);
create unique index club_balance_entries_idempotency_unique on public.club_balance_entries(organisation_id, idempotency_key) where idempotency_key is not null;

create table public.club_stocktakes (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, location_id uuid not null,
  product_id uuid not null, expected_quantity integer not null check (expected_quantity >= 0), counted_quantity integer not null check (counted_quantity >= 0), variance integer generated always as (counted_quantity - expected_quantity) stored,
  actor_user_id uuid references auth.users(id) on delete set null, note text, created_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id), foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);

alter table public.club_payment_accounts enable row level security; alter table public.club_commerce_products enable row level security; alter table public.club_inventory enable row level security;
alter table public.club_orders enable row level security; alter table public.club_order_items enable row level security; alter table public.club_payments enable row level security; alter table public.club_refunds enable row level security; alter table public.club_stock_movements enable row level security; alter table public.club_balance_accounts enable row level security; alter table public.club_balance_entries enable row level security; alter table public.club_stocktakes enable row level security;

create policy club_commerce_products_staff_select on public.club_commerce_products for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or (active and public.club_has_customer_access(organisation_id)));
create policy club_payment_accounts_admin_select on public.club_payment_accounts for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_admin','owner']));
create policy club_inventory_staff_select on public.club_inventory for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_orders_self_select on public.club_orders for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=customer_id and c.user_id=auth.uid()));
create policy club_orders_staff_select on public.club_orders for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_order_items_order_select on public.club_order_items for select to authenticated using (exists(select 1 from public.club_orders o where o.id=order_id and (o.user_id=auth.uid() or public.club_has_active_role(o.organisation_id,array['gym_staff','gym_admin','owner']) or exists(select 1 from public.club_customers c where c.id=o.customer_id and c.user_id=auth.uid()))));
create policy club_payments_self_select on public.club_payments for select to authenticated using (exists(select 1 from public.club_orders o where o.id=order_id and (o.user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=o.customer_id and c.user_id=auth.uid()))));
create policy club_payments_staff_select on public.club_payments for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_refunds_staff_select on public.club_refunds for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_stock_movements_staff_select on public.club_stock_movements for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_balance_accounts_self_select on public.club_balance_accounts for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=customer_id and c.user_id=auth.uid()) or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_balance_entries_self_select on public.club_balance_entries for select to authenticated using (exists(select 1 from public.club_balance_accounts a where a.id=account_id and (a.user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=a.customer_id and c.user_id=auth.uid()) or public.club_has_active_role(a.organisation_id,array['gym_staff','gym_admin','owner']))));
create policy club_stocktakes_staff_select on public.club_stocktakes for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));

create or replace function public.club_save_commerce_product(p_id uuid,p_organisation_id uuid,p_sku text,p_barcode text,p_name text,p_description text,p_category text,p_active boolean,p_stock_tracked boolean,p_sell_price_minor integer,p_cost_price_minor integer,p_currency text,p_tax_code text,p_supplier_reference text,p_media jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_commerce_products%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Commerce catalogue administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or p_sell_price_minor<0 or (p_cost_price_minor is not null and p_cost_price_minor<0) or p_currency !~ '^[A-Z]{3}$' or p_media is not null and jsonb_typeof(p_media)<>'object' then raise exception 'Invalid commerce product input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_commerce_products(organisation_id,sku,barcode,name,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,tax_code,supplier_reference,media)
    values(p_organisation_id,nullif(btrim(p_sku),''),nullif(btrim(p_barcode),''),btrim(p_name),p_description,nullif(btrim(p_category),''),p_active,p_stock_tracked,p_sell_price_minor,p_cost_price_minor,p_currency,p_tax_code,p_supplier_reference,p_media) returning * into v_row;
  else
    update public.club_commerce_products set sku=nullif(btrim(p_sku),''),barcode=nullif(btrim(p_barcode),''),name=btrim(p_name),description=p_description,category=nullif(btrim(p_category),''),active=p_active,stock_tracked=p_stock_tracked,sell_price_minor=p_sell_price_minor,cost_price_minor=p_cost_price_minor,currency=p_currency,tax_code=p_tax_code,supplier_reference=p_supplier_reference,media=p_media,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_create_commerce_order(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_channel text,p_currency text,p_items jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item jsonb; v_product public.club_commerce_products%rowtype; v_qty integer; v_subtotal integer:=0; v_total integer; v_staff boolean; v_existing public.club_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_staff:=public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']);
  if not v_staff and p_channel not in ('member_app','web') then raise exception 'Order channel is not permitted' using errcode='42501'; end if;
  if p_channel not in ('member_app','staff_checkout','quick_sale','web','other') or p_currency !~ '^[A-Z]{3}$' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Invalid order input' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_orders where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return jsonb_build_object('order',to_jsonb(v_existing),'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_existing.id),'[]'::jsonb),'replayed',true); end if; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location is unavailable' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Customer is not in organisation' using errcode='22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=(v_item->>'quantity')::integer; if v_qty is null or v_qty<=0 then raise exception 'Invalid order quantity' using errcode='22023'; end if;
    select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active for update;
    if not found then raise exception 'Commerce product is unavailable' using errcode='P0002'; end if;
    if v_product.currency<>p_currency then raise exception 'Currency mismatch' using errcode='22023'; end if;
    if v_product.stock_tracked and p_location_id is null then raise exception 'Stock-tracked orders require a location' using errcode='22023'; end if;
    v_subtotal:=v_subtotal+(v_product.sell_price_minor*v_qty);
  end loop;
  v_total:=v_subtotal;
  insert into public.club_orders(organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_by,idempotency_key)
  values(p_organisation_id,p_location_id,p_customer_id,case when not v_staff then auth.uid() else null end,p_channel,'pending_payment',p_currency,v_subtotal,0,v_total,auth.uid(),p_idempotency_key) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id;
    v_qty:=(v_item->>'quantity')::integer;
    insert into public.club_order_items(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked) values(v_order.id,p_organisation_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sell_price_minor,v_product.sell_price_minor*v_qty,v_product.stock_tracked);
  end loop;
  return jsonb_build_object('order',to_jsonb(v_order),'items',(select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_order.id),'replayed',false);
end; $$;

create or replace function public.club_record_cash_payment(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_payment public.club_payments%rowtype; v_existing public.club_payments%rowtype; v_order_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash settlement is not permitted' using errcode='42501'; end if;
  if p_amount_minor<0 or p_amount_minor<>v_order.total_minor then raise exception 'Payment amount must settle the order total' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_payments where organisation_id=v_order.organisation_id and external_reference=p_idempotency_key; if found then return to_jsonb(v_existing); end if; end if;
  if v_order.status<>'pending_payment' then raise exception 'Order is not awaiting settlement' using errcode='22023'; end if;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'cash',p_idempotency_key,p_amount_minor,v_order.currency,'paid') returning * into v_payment;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id returning * into v_order;
  for v_order_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_order_item.product_id,'sale',-v_order_item.quantity,v_order.id,auth.uid(),case when p_idempotency_key is null then null else p_idempotency_key||':'||v_order_item.product_id::text end);
  end loop;
  return to_jsonb(v_payment);
end; $$;

create or replace function public.club_credit_balance(p_organisation_id uuid,p_customer_id uuid,p_user_id uuid,p_currency text,p_amount_minor integer,p_entry_type text,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_account public.club_balance_accounts%rowtype; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype; v_staff boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; v_staff:=public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']);
  if not v_staff then raise exception 'Balance credit is not permitted' using errcode='42501'; end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_entry_type not in ('top_up','manual_credit','promotional_credit','refund') then raise exception 'Invalid balance credit' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_balance_entries where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if; end if;
  select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and ((p_customer_id is not null and customer_id=p_customer_id) or (p_user_id is not null and user_id=p_user_id)) for update;
  if not found then insert into public.club_balance_accounts(organisation_id,customer_id,user_id,currency) values(p_organisation_id,p_customer_id,p_user_id,p_currency) returning * into v_account; end if;
  if v_account.currency<>p_currency or v_account.status<>'active' then raise exception 'Balance account is unavailable' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,actor_user_id,reason,idempotency_key) values(v_account.id,p_organisation_id,p_entry_type,p_amount_minor,(select coalesce(sum(amount_delta_minor),0) from public.club_balance_entries where account_id=v_account.id)+p_amount_minor,auth.uid(),p_reason,p_idempotency_key) returning * into v_entry;
  return to_jsonb(v_entry);
end; $$;

create or replace function public.club_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_account public.club_balance_accounts%rowtype; v_balance integer; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype; v_order_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or v_order.user_id is distinct from auth.uid() then raise exception 'Balance spend is not permitted' using errcode='42501'; end if;
  select * into v_existing from public.club_balance_entries where organisation_id=v_order.organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if;
  if p_amount_minor<=0 or p_idempotency_key is null or p_amount_minor<>v_order.total_minor then raise exception 'Balance settlement must equal the order total' using errcode='22023'; end if;
  if v_order.status<>'pending_payment' then raise exception 'Order is not awaiting settlement' using errcode='22023'; end if;
  select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and user_id=auth.uid() for update; if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0); if v_balance<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(v_account.id,v_order.organisation_id,'purchase',-p_amount_minor,v_balance-p_amount_minor,v_order.id,auth.uid(),p_idempotency_key) returning * into v_entry;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key,p_amount_minor,v_order.currency,'paid');
  for v_order_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_order_item.product_id,'sale',-v_order_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_order_item.id::text);
  end loop;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
  return to_jsonb(v_entry);
end; $$;

create or replace function public.club_adjust_inventory(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_movement_type text,p_quantity_delta integer,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_stock_movements%rowtype; v_existing public.club_stock_movements%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Inventory adjustment is not permitted' using errcode='42501'; end if;
  if p_quantity_delta=0 or p_movement_type not in ('delivery','transfer_in','transfer_out','return','waste','damage','complimentary','stocktake_adjustment','manual_adjustment') then raise exception 'Invalid inventory movement' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_stock_movements where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if; end if;
  if not exists(select 1 from public.club_inventory where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id) then insert into public.club_inventory(organisation_id,location_id,product_id) values(p_organisation_id,p_location_id,p_product_id); end if;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_product_id,p_movement_type,p_quantity_delta,p_reason,auth.uid(),p_idempotency_key) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

revoke all privileges on table public.club_payment_accounts,public.club_commerce_products,public.club_inventory,public.club_orders,public.club_order_items,public.club_payments,public.club_refunds,public.club_stock_movements,public.club_balance_accounts,public.club_balance_entries,public.club_stocktakes from public,anon,authenticated;
grant select on table public.club_payment_accounts,public.club_commerce_products,public.club_inventory,public.club_orders,public.club_order_items,public.club_payments,public.club_refunds,public.club_stock_movements,public.club_balance_accounts,public.club_balance_entries,public.club_stocktakes to authenticated;

revoke all on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb),public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text),public.club_record_cash_payment(uuid,integer,text),public.club_credit_balance(uuid,uuid,uuid,text,integer,text,text,text),public.club_spend_balance(uuid,integer,text),public.club_adjust_inventory(uuid,uuid,uuid,text,integer,text,text) from public;
grant execute on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb),public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text),public.club_record_cash_payment(uuid,integer,text),public.club_credit_balance(uuid,uuid,uuid,text,integer,text,text,text),public.club_spend_balance(uuid,integer,text),public.club_adjust_inventory(uuid,uuid,uuid,text,integer,text,text) to authenticated;

comment on table public.club_payment_accounts is 'Provider-neutral merchant references only; never store API keys, secrets or R12 platform subscription revenue here.';
comment on table public.club_stock_movements is 'Immutable inventory ledger; current stock is derived from quantity_delta, never overwritten directly.';
comment on table public.club_balance_accounts is 'Organisation-scoped stored credit. It is not a transferable universal R12 wallet and does not imply R12 custody of funds.';
comment on table public.club_orders is 'Gym commerce only. R12 consumer subscriptions use a separate platform-revenue domain.';

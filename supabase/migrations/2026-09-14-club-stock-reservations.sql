create table if not exists public.club_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null references public.club_locations(id) on delete restrict,
  product_id uuid not null references public.club_commerce_products(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references public.club_customers(id) on delete set null,
  order_id uuid not null references public.club_orders(id) on delete cascade,
  order_item_id uuid references public.club_order_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active','fulfilled','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists club_stock_reservations_balance_idx on public.club_stock_reservations(organisation_id,location_id,product_id,status);
create index if not exists club_stock_reservations_order_idx on public.club_stock_reservations(organisation_id,order_id,status);
create index if not exists club_stock_reservations_user_idx on public.club_stock_reservations(organisation_id,user_id,status);
alter table public.club_stock_reservations enable row level security;
revoke all on public.club_stock_reservations from public, anon, authenticated;

create or replace function public.club_reserve_order_stock(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item public.club_order_items%rowtype; v_on_hand integer; v_reserved integer; v_available integer; v_existing integer; v_created integer:=0;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or (v_order.user_id is distinct from auth.uid() and not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Order reservation is not permitted' using errcode='42501'; end if;
  if v_order.location_id is null then return jsonb_build_object('reserved',0); end if;
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    perform pg_advisory_xact_lock(hashtextextended(v_order.organisation_id::text||':'||v_order.location_id::text||':'||v_item.product_id::text,0));
    select coalesce(sum(quantity_delta),0) into v_on_hand from public.club_stock_movements where organisation_id=v_order.organisation_id and location_id=v_order.location_id and product_id=v_item.product_id;
    select coalesce(sum(quantity),0) into v_reserved from public.club_stock_reservations where organisation_id=v_order.organisation_id and location_id=v_order.location_id and product_id=v_item.product_id and status='active';
    select coalesce(sum(quantity),0) into v_existing from public.club_stock_reservations where order_id=v_order.id and order_item_id=v_item.id and status='active';
    v_available:=v_on_hand-v_reserved+v_existing;
    if v_available < v_item.quantity then raise exception 'Insufficient stock for reservation' using errcode='23514'; end if;
    if v_existing=0 then insert into public.club_stock_reservations(organisation_id,location_id,product_id,user_id,customer_id,order_id,order_item_id,quantity) values(v_order.organisation_id,v_order.location_id,v_item.product_id,v_order.user_id,v_order.customer_id,v_order.id,v_item.id,v_item.quantity); v_created:=v_created+1; end if;
  end loop;
  return jsonb_build_object('reserved',v_created);
end; $$;

create or replace function public.club_release_order_reservations(p_order_id uuid, p_status text default 'cancelled')
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_count integer;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or (v_order.user_id is distinct from auth.uid() and not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Reservation release is not permitted' using errcode='42501'; end if;
  update public.club_stock_reservations set status=case when p_status='fulfilled' then 'fulfilled' else 'cancelled' end, updated_at=now(), fulfilled_at=case when p_status='fulfilled' then now() else fulfilled_at end, cancelled_at=case when p_status='fulfilled' then cancelled_at else now() end where order_id=p_order_id and status='active'; get diagnostics v_count=row_count; return v_count;
end; $$;

create or replace function public.club_stock_reservation_order_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('cancelled','refunded') and old.status is distinct from new.status then update public.club_stock_reservations set status='cancelled',updated_at=now(),cancelled_at=now() where order_id=new.id and status='active'; end if;
  return new;
end; $$;
drop trigger if exists club_stock_reservation_order_status on public.club_orders;
create trigger club_stock_reservation_order_status after update of status on public.club_orders for each row execute function public.club_stock_reservation_order_trigger();

create or replace function public.club_stock_reservation_sale_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.movement_type='sale' and new.order_id is not null then update public.club_stock_reservations set status='fulfilled',updated_at=now(),fulfilled_at=now() where order_id=new.order_id and product_id=new.product_id and status='active'; end if;
  return new;
end; $$;
drop trigger if exists club_stock_reservation_sale on public.club_stock_movements;
create trigger club_stock_reservation_sale after insert on public.club_stock_movements for each row execute function public.club_stock_reservation_sale_trigger();
revoke all on function public.club_reserve_order_stock(uuid), public.club_release_order_reservations(uuid,text) from public, anon;
grant execute on function public.club_reserve_order_stock(uuid), public.club_release_order_reservations(uuid,text) to authenticated;

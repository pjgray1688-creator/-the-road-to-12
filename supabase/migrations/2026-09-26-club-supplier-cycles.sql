-- Supplier-specific ordering cycles and location replenishment.
-- Run after 2026-09-22-club-supplier-commerce.sql.

alter table public.club_suppliers
  add column if not exists timezone text not null default 'Europe/London',
  add column if not exists ordering_active boolean not null default true,
  add column if not exists cutoff_weekday smallint,
  add column if not exists cutoff_local_time time,
  add column if not exists order_weekday smallint,
  add column if not exists delivery_start_weekday smallint,
  add column if not exists delivery_end_weekday smallint;
do $$ begin
  alter table public.club_suppliers drop constraint if exists club_suppliers_weekdays_ck;
  alter table public.club_suppliers add constraint club_suppliers_weekdays_ck check (
    (cutoff_weekday is null or cutoff_weekday between 0 and 6) and
    (order_weekday is null or order_weekday between 0 and 6) and
    (delivery_start_weekday is null or delivery_start_weekday between 0 and 6) and
    (delivery_end_weekday is null or delivery_end_weekday between 0 and 6));
end $$;

create table if not exists public.club_supplier_order_cycles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete restrict,
  cycle_key text not null,
  cutoff_at timestamptz,
  order_date date,
  delivery_start_date date,
  delivery_end_date date,
  status text not null default 'open' check (status in ('open','prepared','ordered','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, supplier_id, cycle_key));

alter table public.club_supplier_order_batches add column if not exists cycle_id uuid references public.club_supplier_order_cycles(id) on delete restrict;
alter table public.club_supplier_demand add column if not exists cycle_id uuid references public.club_supplier_order_cycles(id) on delete restrict;
create unique index if not exists club_supplier_order_batches_cycle_uq on public.club_supplier_order_batches(organisation_id,supplier_id,cycle_id) where cycle_id is not null;
alter table public.club_supplier_order_batch_lines
  add column if not exists member_quantity integer not null default 0,
  add column if not exists replenishment_quantity integer not null default 0,
  add column if not exists replenishment_location_id uuid references public.club_locations(id) on delete restrict;
update public.club_supplier_order_batch_lines set member_quantity=quantity_ordered where member_quantity=0 and replenishment_quantity=0;
alter table public.club_supplier_order_batch_lines drop constraint if exists club_supplier_order_batch_lines_provenance_ck;
alter table public.club_supplier_order_batch_lines add constraint club_supplier_order_batch_lines_provenance_ck check (member_quantity >= 0 and replenishment_quantity >= 0 and member_quantity + replenishment_quantity = quantity_ordered);

create table if not exists public.club_supplier_replenishment_rules (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, product_id uuid not null, supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict,
  minimum_quantity integer not null check (minimum_quantity >= 0), target_quantity integer not null check (target_quantity >= minimum_quantity), enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id,location_id,product_id), foreign key (location_id,organisation_id) references public.club_locations(id,organisation_id), foreign key (product_id,organisation_id) references public.club_commerce_products(id,organisation_id));
create table if not exists public.club_supplier_replenishment_requirements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  cycle_id uuid not null references public.club_supplier_order_cycles(id) on delete restrict, rule_id uuid not null references public.club_supplier_replenishment_rules(id) on delete restrict,
  supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict, location_id uuid not null references public.club_locations(id) on delete restrict,
  quantity_required integer not null check (quantity_required > 0), batch_line_id uuid references public.club_supplier_order_batch_lines(id) on delete restrict,
  created_at timestamptz not null default now(), unique (cycle_id,rule_id));
alter table public.club_supplier_order_cycles enable row level security;
alter table public.club_supplier_replenishment_rules enable row level security;
alter table public.club_supplier_replenishment_requirements enable row level security;
revoke all on public.club_supplier_order_cycles,public.club_supplier_replenishment_rules,public.club_supplier_replenishment_requirements from anon,authenticated;

create or replace function public.club_prepare_supplier_cycle(p_organisation_id uuid,p_supplier_id uuid,p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; c public.club_supplier_order_cycles%rowtype; b public.club_supplier_order_batches%rowtype;
  d record; r record; line_id uuid; local_date date; local_time time; weekday integer; days_to_order integer; after_cutoff boolean; cycle_date date; needed integer; free_stock integer; inbound integer; n integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where id=p_supplier_id and organisation_id=p_organisation_id and active for update;
  if not found or not s.ordering_active then raise exception 'Supplier ordering is not configured' using errcode='P0002'; end if;
  if s.cutoff_weekday is null or s.cutoff_local_time is null or s.order_weekday is null then raise exception 'Supplier schedule is incomplete' using errcode='22023'; end if;
  local_date := (p_at at time zone s.timezone)::date; local_time := (p_at at time zone s.timezone)::time; weekday := extract(isodow from local_date)::integer % 7;
  after_cutoff := weekday > s.cutoff_weekday or (weekday=s.cutoff_weekday and local_time>=s.cutoff_local_time);
  days_to_order := (s.order_weekday-weekday+7)%7;
  if after_cutoff then days_to_order:=days_to_order+7; end if;
  cycle_date := local_date+days_to_order;
  insert into public.club_supplier_order_cycles(organisation_id,supplier_id,cycle_key,cutoff_at,order_date,delivery_start_date,delivery_end_date,status)
  values(p_organisation_id,p_supplier_id,cycle_date::text,(((cycle_date-((s.order_weekday-s.cutoff_weekday+7)%7))::date+s.cutoff_local_time) at time zone s.timezone),cycle_date,
    case when s.delivery_start_weekday is null then null else cycle_date+(s.delivery_start_weekday-s.order_weekday+7)%7 end,
    case when s.delivery_end_weekday is null then null else cycle_date+(s.delivery_end_weekday-s.order_weekday+7)%7 end,'open')
  on conflict (organisation_id,supplier_id,cycle_key) do update set updated_at=now() returning * into c;
  select * into b from public.club_supplier_order_batches where organisation_id=p_organisation_id and supplier_id=p_supplier_id and cycle_id=c.id for update;
  if found then return jsonb_build_object('cycle',to_jsonb(c),'batch',to_jsonb(b),'reused',true); end if;
  insert into public.club_supplier_order_counters(organisation_id,next_value) values(p_organisation_id,2) on conflict(organisation_id) do update set next_value=club_supplier_order_counters.next_value+1 returning next_value-1 into n;
  insert into public.club_supplier_order_batches(organisation_id,supplier_id,cycle_id,reference,created_by) values(p_organisation_id,p_supplier_id,c.id,'SUP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(n::text,4,'0'),auth.uid()) returning * into b;
  for d in select supplier_product_id,sum(quantity_required)::integer quantity from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null group by supplier_product_id loop
    insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity) values(b.id,d.supplier_product_id,d.quantity,d.quantity,0);
    update public.club_supplier_demand set batch_id=b.id,cycle_id=c.id,updated_at=now() where organisation_id=p_organisation_id and supplier_id=p_supplier_id and supplier_product_id=d.supplier_product_id and status='outstanding' and batch_id is null;
  end loop;
  for r in select rr.* from public.club_supplier_replenishment_rules rr join public.club_supplier_products sp on sp.id=rr.supplier_product_id where rr.organisation_id=p_organisation_id and rr.enabled and sp.supplier_id=p_supplier_id and sp.sellable and not sp.discontinued loop
    select coalesce(sum(quantity_delta),0) into free_stock from public.club_stock_movements where organisation_id=p_organisation_id and location_id=r.location_id and product_id=r.product_id;
    select coalesce(sum(greatest(bl.replenishment_quantity-coalesce((select sum(rl.replenishment_quantity_received) from public.club_supplier_receipt_lines rl where rl.batch_line_id=bl.id),0),0)),0) into inbound from public.club_supplier_order_batch_lines bl join public.club_supplier_order_batches bb on bb.id=bl.batch_id where bb.organisation_id=p_organisation_id and bb.supplier_id=p_supplier_id and bb.status in ('draft','ordered','partially_received') and bl.supplier_product_id=r.supplier_product_id;
    if free_stock+inbound<r.minimum_quantity then needed:=greatest(0,r.target_quantity-free_stock-inbound); else needed:=0; end if;
    if needed>0 then
      insert into public.club_supplier_replenishment_requirements(organisation_id,cycle_id,rule_id,supplier_product_id,location_id,quantity_required) values(p_organisation_id,c.id,r.id,r.supplier_product_id,r.location_id,needed) on conflict(cycle_id,rule_id) do update set quantity_required=excluded.quantity_required;
      select id into line_id from public.club_supplier_order_batch_lines where batch_id=b.id and supplier_product_id=r.supplier_product_id;
      if line_id is null then insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity,replenishment_location_id) values(b.id,r.supplier_product_id,needed,0,needed,r.location_id) returning id into line_id;
      else update public.club_supplier_order_batch_lines set quantity_ordered=quantity_ordered+needed,replenishment_quantity=replenishment_quantity+needed where id=line_id; end if;
      update public.club_supplier_replenishment_requirements set batch_line_id=line_id where cycle_id=c.id and rule_id=r.id;
    end if;
  end loop;
  update public.club_supplier_order_cycles set status='prepared',updated_at=now() where id=c.id;
  return jsonb_build_object('cycle',to_jsonb(c),'batch',to_jsonb(b),'reused',false);
end; $$;
revoke all on function public.club_prepare_supplier_cycle(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_prepare_supplier_cycle(uuid,uuid,timestamptz) to authenticated;

create or replace function public.club_supplier_cycle_timing(p_organisation_id uuid,p_supplier_id uuid,p_at timestamptz default now()) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select case when s.cutoff_weekday is null or s.cutoff_local_time is null or s.order_weekday is null or not s.ordering_active then jsonb_build_object('message','Available to order — collection timing confirmed after order') else jsonb_build_object('message','Next supplier cycle · timing configured','timezone',s.timezone,'cutoff_weekday',s.cutoff_weekday,'cutoff_local_time',s.cutoff_local_time,'order_weekday',s.order_weekday,'delivery_start_weekday',s.delivery_start_weekday,'delivery_end_weekday',s.delivery_end_weekday) end from public.club_suppliers s where s.id=p_supplier_id and s.organisation_id=p_organisation_id and s.active;
$$;
revoke all on function public.club_supplier_cycle_timing(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_supplier_cycle_timing(uuid,uuid,timestamptz) to authenticated;

create or replace function public.club_mark_supplier_ordered(p_organisation_id uuid,p_batch_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; c public.club_supplier_order_cycles%rowtype;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Supplier order not found' using errcode='P0002'; end if;
  if b.status='ordered' then return to_jsonb(b); end if;
  update public.club_supplier_order_batches set status='ordered',ordered_by=auth.uid(),ordered_at=coalesce(ordered_at,now()),updated_at=now() where id=b.id returning * into b;
  update public.club_supplier_demand set status='ordered',ordered_at=b.ordered_at,updated_at=now() where batch_id=b.id and status='outstanding';
  if b.cycle_id is not null then update public.club_supplier_order_cycles set status='ordered',updated_at=now() where id=b.cycle_id returning * into c; end if;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_mark_supplier_ordered(uuid,uuid) from public,anon; grant execute on function public.club_mark_supplier_ordered(uuid,uuid) to authenticated;

-- Receipt lines retain which units are customer allocations versus replenishment.
alter table public.club_supplier_receipt_lines
  add column if not exists member_quantity_received integer not null default 0,
  add column if not exists replenishment_quantity_received integer not null default 0;
update public.club_supplier_receipt_lines set member_quantity_received=quantity_received where member_quantity_received=0 and replenishment_quantity_received=0;
alter table public.club_supplier_receipt_lines drop constraint if exists club_supplier_receipt_lines_provenance_ck;
alter table public.club_supplier_receipt_lines add constraint club_supplier_receipt_lines_provenance_ck check (member_quantity_received >= 0 and replenishment_quantity_received >= 0 and member_quantity_received + replenishment_quantity_received = quantity_received);

create or replace function public.club_receive_supplier_delivery(p_organisation_id uuid,p_batch_id uuid,p_idempotency_key text,p_lines jsonb,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; r public.club_supplier_receipts%rowtype; line jsonb; bl public.club_supplier_order_batch_lines%rowtype; prior integer; remaining integer; qty integer; member_qty integer; replenish_qty integer;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Supplier receiving is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Invalid receipt' using errcode='22023'; end if;
  select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.status='draft' then raise exception 'Supplier order is not receivable' using errcode='P0002'; end if;
  select * into r from public.club_supplier_receipts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then if r.batch_id<>b.id then raise exception 'Receipt idempotency key already belongs to another order' using errcode='23505'; end if; return to_jsonb(r); end if;
  insert into public.club_supplier_receipts(organisation_id,batch_id,supplier_id,received_by,idempotency_key,notes) values(p_organisation_id,b.id,b.supplier_id,auth.uid(),p_idempotency_key,p_notes) returning * into r;
  for line in select value from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantityReceived')::integer,0);
    select * into bl from public.club_supplier_order_batch_lines where id=(line->>'batchLineId')::uuid and batch_id=b.id for update;
    if not found or qty<1 then raise exception 'Invalid receipt line' using errcode='22023'; end if;
    select coalesce(sum(quantity_received),0) into prior from public.club_supplier_receipt_lines where batch_line_id=bl.id;
    remaining:=bl.quantity_ordered-prior; if qty>remaining then raise exception 'Receipt exceeds ordered quantity' using errcode='22023'; end if;
    select coalesce(sum(member_quantity_received),0) into prior from public.club_supplier_receipt_lines where batch_line_id=bl.id;
    member_qty:=least(qty,greatest(0,bl.member_quantity-prior)); replenish_qty:=qty-member_qty;
    insert into public.club_supplier_receipt_lines(receipt_id,batch_line_id,quantity_received,member_quantity_received,replenishment_quantity_received,notes) values(r.id,bl.id,qty,member_qty,replenish_qty,line->>'notes');
    if replenish_qty>0 then
      if bl.replenishment_location_id is null then raise exception 'Replenishment location is missing' using errcode='22023'; end if;
      insert into public.club_inventory(organisation_id,location_id,product_id) values(p_organisation_id,bl.replenishment_location_id,(select product_id from public.club_supplier_replenishment_rules rr where rr.supplier_product_id=bl.supplier_product_id and rr.location_id=bl.replenishment_location_id limit 1)) on conflict (organisation_id,location_id,product_id) do nothing;
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,actor_user_id,idempotency_key,reason) select p_organisation_id,bl.replenishment_location_id,rr.product_id,'delivery',replenish_qty,auth.uid(),p_idempotency_key||':'||bl.id::text,'Supplier replenishment receipt' from public.club_supplier_replenishment_rules rr where rr.supplier_product_id=bl.supplier_product_id and rr.location_id=bl.replenishment_location_id;
    end if;
  end loop;
  update public.club_supplier_order_batches set status=case when not exists(select 1 from public.club_supplier_order_batch_lines x where x.batch_id=b.id and x.quantity_ordered>coalesce((select sum(quantity_received) from public.club_supplier_receipt_lines where batch_line_id=x.id),0)) then 'received' when exists(select 1 from public.club_supplier_receipt_lines rl join public.club_supplier_order_batch_lines x on x.id=rl.batch_line_id where x.batch_id=b.id) then 'partially_received' else 'ordered' end,updated_at=now() where id=b.id;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) from public,anon; grant execute on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) to authenticated;

create or replace function public.club_allocate_supplier_units(p_organisation_id uuid,p_receipt_line_id uuid,p_demand_id uuid,p_quantity integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rl public.club_supplier_receipt_lines%rowtype; d public.club_supplier_demand%rowtype; used integer; ready boolean;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') or p_quantity<1 then raise exception 'Supplier allocation is not permitted' using errcode='42501'; end if;
  select * into rl from public.club_supplier_receipt_lines where id=p_receipt_line_id for update;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or rl.id is null then raise exception 'Allocation target not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_supplier_order_batch_lines bl join public.club_supplier_receipts r on r.batch_id=bl.batch_id where bl.id=rl.batch_line_id and r.organisation_id=p_organisation_id and bl.supplier_product_id=d.supplier_product_id and d.batch_id=bl.batch_id) then raise exception 'Allocation product or batch mismatch' using errcode='22023'; end if;
  select coalesce(sum(quantity_allocated),0) into used from public.club_supplier_allocations where receipt_line_id=rl.id;
  if used+p_quantity>rl.member_quantity_received or d.quantity_allocated+p_quantity>d.quantity_required then raise exception 'Allocation exceeds available quantity' using errcode='22023'; end if;
  insert into public.club_supplier_allocations(organisation_id,receipt_line_id,demand_id,quantity_allocated,allocated_by) values(p_organisation_id,rl.id,d.id,p_quantity,auth.uid());
  update public.club_supplier_demand set quantity_allocated=quantity_allocated+p_quantity,quantity_received=quantity_received+p_quantity,updated_at=now() where id=d.id returning * into d;
  if d.quantity_allocated>=d.quantity_required then update public.club_supplier_demand set status='ready_for_collection',ready_at=coalesce(ready_at,now()),updated_at=now() where id=d.id; end if;
  select not exists(select 1 from public.club_supplier_demand x where x.order_id=d.order_id and x.status not in ('ready_for_collection','collected','cancelled')) into ready;
  if ready then insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'order_ready_for_collection',d.order_id,jsonb_build_object('state','queued')) on conflict(order_id,event_type) do nothing; end if;
  return to_jsonb(d);
end; $$;
revoke all on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) from public,anon; grant execute on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) to authenticated;

-- Expose cycle provenance through the existing ordering screen.
create or replace function public.club_list_supplier_order_batches(p_organisation_id uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',b.id,'reference',b.reference,'supplier',s.name,'status',b.status,'created_at',b.created_at,'ordered_at',b.ordered_at,
  'cycle_key',c.cycle_key,'cutoff_at',c.cutoff_at,'order_date',c.order_date,'delivery_start_date',c.delivery_start_date,'delivery_end_date',c.delivery_end_date,
  'lines',(select count(*) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'units',(select coalesce(sum(x.quantity_ordered),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'member_units',(select coalesce(sum(x.member_quantity),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'replenishment_units',(select coalesce(sum(x.replenishment_quantity),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id)
) order by b.created_at desc),'[]'::jsonb)
from public.club_supplier_order_batches b join public.club_suppliers s on s.id=b.supplier_id left join public.club_supplier_order_cycles c on c.id=b.cycle_id
where b.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_supplier_order_batches(uuid) from public,anon; grant execute on function public.club_list_supplier_order_batches(uuid) to authenticated;

-- Keep the legacy manual action compatible with line provenance.
create or replace function public.club_create_supplier_order_batch(p_organisation_id uuid,p_supplier_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; l record; n integer; ref text;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  perform 1 from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null for update;
  if not found then raise exception 'No outstanding supplier demand' using errcode='P0002'; end if;
  insert into public.club_supplier_order_counters(organisation_id,next_value) values(p_organisation_id,2) on conflict(organisation_id) do update set next_value=club_supplier_order_counters.next_value+1 returning next_value-1 into n;
  ref:='SUP-'||to_char(now(),'YYYYMMDD')||'-'||lpad(n::text,4,'0');
  insert into public.club_supplier_order_batches(organisation_id,supplier_id,reference,created_by) values(p_organisation_id,p_supplier_id,ref,auth.uid()) returning * into b;
  for l in select supplier_product_id,sum(quantity_required)::integer quantity from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null group by supplier_product_id loop
    insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity) values(b.id,l.supplier_product_id,l.quantity,l.quantity,0);
    update public.club_supplier_demand set batch_id=b.id,updated_at=now() where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null and supplier_product_id=l.supplier_product_id;
  end loop;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_create_supplier_order_batch(uuid,uuid) from public,anon; grant execute on function public.club_create_supplier_order_batch(uuid,uuid) to authenticated;

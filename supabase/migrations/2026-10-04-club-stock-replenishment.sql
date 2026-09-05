-- Location-specific replenishment review over the existing supplier-cycle rules.
create or replace function public.club_list_replenishment_review(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('supplier',s.name,'supplier_id',s.id,'product_id',r.product_id,'product',cp.name,'supplier_sku',sp.supplier_sku,'location_id',r.location_id,'location',l.name,'minimum',r.minimum_quantity,'available',greatest(coalesce((select sum(m.quantity_delta) from public.club_stock_movements m where m.organisation_id=r.organisation_id and m.location_id=r.location_id and m.product_id=r.product_id),0),0),'need',greatest(r.minimum_quantity-greatest(coalesce((select sum(m.quantity_delta) from public.club_stock_movements m where m.organisation_id=r.organisation_id and m.location_id=r.location_id and m.product_id=r.product_id),0),0),0)) order by s.name,cp.name,l.name),'[]'::jsonb)
from public.club_supplier_replenishment_rules r join public.club_supplier_products sp on sp.id=r.supplier_product_id join public.club_suppliers s on s.id=sp.supplier_id join public.club_commerce_products cp on cp.id=r.product_id join public.club_locations l on l.id=r.location_id
where r.organisation_id=p_organisation_id and r.enabled and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_review(uuid) from public,anon; grant execute on function public.club_list_replenishment_review(uuid) to authenticated;
create or replace function public.club_save_replenishment_rule(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_supplier_product_id uuid,p_minimum_quantity integer,p_target_quantity integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_supplier_replenishment_rules%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Replenishment management is not permitted' using errcode='42501'; end if;
 if p_minimum_quantity<0 or p_target_quantity<p_minimum_quantity then raise exception 'Invalid replenishment quantities' using errcode='22023'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not exists(select 1 from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id) or not exists(select 1 from public.club_supplier_products where id=p_supplier_product_id and organisation_id=p_organisation_id and club_product_id=p_product_id and sellable and not discontinued) then raise exception 'Replenishment references are invalid' using errcode='22023'; end if;
 insert into public.club_supplier_replenishment_rules(organisation_id,location_id,product_id,supplier_product_id,minimum_quantity,target_quantity,created_by) values(p_organisation_id,p_location_id,p_product_id,p_supplier_product_id,p_minimum_quantity,p_target_quantity,auth.uid()) on conflict(organisation_id,location_id,product_id) do update set supplier_product_id=excluded.supplier_product_id,minimum_quantity=excluded.minimum_quantity,target_quantity=excluded.target_quantity,updated_at=now() returning * into r;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_replenishment_rule(uuid,uuid,uuid,uuid,integer,integer) from public,anon; grant execute on function public.club_save_replenishment_rule(uuid,uuid,uuid,uuid,integer,integer) to authenticated;

create table if not exists public.club_supplier_replenishment_allocations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  batch_line_id uuid not null references public.club_supplier_order_batch_lines(id) on delete cascade,
  location_id uuid not null, quantity integer not null check (quantity > 0),
  unique (batch_line_id, location_id), foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id)
);
alter table public.club_supplier_replenishment_allocations enable row level security;
revoke all on public.club_supplier_replenishment_allocations from public,anon,authenticated;

create or replace function public.club_update_replenishment_allocation(p_organisation_id uuid,p_batch_line_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare total integer; item jsonb; line record;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') or jsonb_typeof(p_allocations)<>'array' then raise exception 'Replenishment allocation is not permitted' using errcode='42501'; end if;
 select * into line from public.club_supplier_order_batch_lines where id=p_batch_line_id and batch_id in (select id from public.club_supplier_order_batches where organisation_id=p_organisation_id) for update;
 if not found then raise exception 'Supplier order line not found' using errcode='P0002'; end if;
 select coalesce(sum((value->>'quantity')::integer),0) into total from jsonb_array_elements(p_allocations);
 if total<>line.quantity_ordered or exists(select 1 from jsonb_array_elements(p_allocations) value where (value->>'quantity')::integer<1 or not exists(select 1 from public.club_locations where id=(value->>'locationId')::uuid and organisation_id=p_organisation_id and active)) then raise exception 'Allocations must equal the ordered quantity' using errcode='22023'; end if;
 delete from public.club_supplier_replenishment_allocations where batch_line_id=line.id;
 for item in select value from jsonb_array_elements(p_allocations) loop insert into public.club_supplier_replenishment_allocations(organisation_id,batch_line_id,location_id,quantity) values(p_organisation_id,line.id,(item->>'locationId')::uuid,(item->>'quantity')::integer); end loop;
 return jsonb_build_object('batch_line_id',line.id,'quantity_ordered',line.quantity_ordered,'allocations',p_allocations);
end; $$;
revoke all on function public.club_update_replenishment_allocation(uuid,uuid,jsonb) from public,anon; grant execute on function public.club_update_replenishment_allocation(uuid,uuid,jsonb) to authenticated;

create or replace function public.club_list_replenishment_distribution(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('location_id',a.location_id,'location',l.name,'product_id',sp.club_product_id,'product',coalesce(cp.name,sp.name),'supplier_sku',sp.supplier_sku,'quantity',a.quantity) order by l.name,coalesce(cp.name,sp.name)),'[]'::jsonb)
from public.club_supplier_replenishment_allocations a join public.club_supplier_order_batch_lines bl on bl.id=a.batch_line_id join public.club_supplier_products sp on sp.id=bl.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id join public.club_locations l on l.id=a.location_id
where a.organisation_id=p_organisation_id and bl.batch_id=p_batch_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_distribution(uuid,uuid) from public,anon; grant execute on function public.club_list_replenishment_distribution(uuid,uuid) to authenticated;

create or replace function public.club_update_replenishment_line(p_organisation_id uuid,p_batch_line_id uuid,p_quantity_ordered integer,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare line public.club_supplier_order_batch_lines%rowtype; total integer;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') or p_quantity_ordered<1 or jsonb_typeof(p_allocations)<>'array' then raise exception 'Invalid replenishment update' using errcode='42501'; end if;
 select bl.* into line from public.club_supplier_order_batch_lines bl join public.club_supplier_order_batches b on b.id=bl.batch_id where bl.id=p_batch_line_id and b.organisation_id=p_organisation_id and b.status='draft' for update;
 if not found or line.member_quantity<>0 then raise exception 'Customer demand quantity is not editable' using errcode='22023'; end if;
 select coalesce(sum((value->>'quantity')::integer),0) into total from jsonb_array_elements(p_allocations);
 if total<>p_quantity_ordered or exists(select 1 from jsonb_array_elements(p_allocations) value where (value->>'quantity')::integer<1 or not exists(select 1 from public.club_locations where id=(value->>'locationId')::uuid and organisation_id=p_organisation_id and active)) then raise exception 'Allocations must equal ordered quantity' using errcode='22023'; end if;
 update public.club_supplier_order_batch_lines set quantity_ordered=p_quantity_ordered,replenishment_quantity=p_quantity_ordered,replenishment_location_id=null where id=line.id;
 delete from public.club_supplier_replenishment_allocations where batch_line_id=line.id;
 insert into public.club_supplier_replenishment_allocations(organisation_id,batch_line_id,location_id,quantity) select p_organisation_id,line.id,(value->>'locationId')::uuid,(value->>'quantity')::integer from jsonb_array_elements(p_allocations) value;
 return jsonb_build_object('batch_line_id',line.id,'quantity_ordered',p_quantity_ordered,'allocations',p_allocations);
end; $$;
revoke all on function public.club_update_replenishment_line(uuid,uuid,integer,jsonb) from public,anon; grant execute on function public.club_update_replenishment_line(uuid,uuid,integer,jsonb) to authenticated;
create or replace function public.club_list_replenishment_lines(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id', bl.id,
      'batch_id', bl.batch_id,
      'quantity_ordered', bl.quantity_ordered,
      'supplier_product_id', bl.supplier_product_id,
      'supplier_sku', sp.supplier_sku,
      'product', coalesce(cp.name, sp.name),
      'supplier', s.name,
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('location_id', a.location_id, 'quantity', a.quantity)) from public.club_supplier_replenishment_allocations a where a.batch_line_id = bl.id), '[]'::jsonb)
    )
  ),
  '[]'::jsonb
)
from public.club_supplier_order_batch_lines bl
join public.club_supplier_order_batches b on b.id = bl.batch_id
join public.club_supplier_products sp on sp.id = bl.supplier_product_id
join public.club_suppliers s on s.id = sp.supplier_id
left join public.club_commerce_products cp on cp.id = sp.club_product_id
where b.organisation_id = p_organisation_id
  and b.status = 'draft'
  and bl.member_quantity = 0
  and bl.replenishment_quantity > 0
  and public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_lines(uuid) from public,anon; grant execute on function public.club_list_replenishment_lines(uuid) to authenticated;

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

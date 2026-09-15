-- Restore the canonical durable catalogue query; only staff authorisation differs.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',coalesce((select p.retail_price_minor from public.club_supplier_variant_prices p where p.organisation_id=sp.organisation_id and p.supplier_product_id=sp.id and p.active and (p.effective_to is null or p.effective_to>now()) order by p.effective_from desc limit 1),sp.retail_price_minor)) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active
  and auth.uid() is not null
  and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('member','gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;

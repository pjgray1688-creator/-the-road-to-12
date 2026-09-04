-- Operational supplier catalogue review, canonical linking and publication.
create or replace function public.club_list_supplier_catalogue(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',sp.id,'supplier_id',sp.supplier_id,'supplier',s.name,'supplier_sku',sp.supplier_sku,
  'barcode',sp.barcode,'brand',sp.brand,'name',sp.name,'variant',sp.variant,'size',sp.size,
  'category',sp.category,'wholesale_cost_minor',sp.wholesale_cost_minor,'supplier_rrp_minor',sp.supplier_rrp_minor,
  'supplier_availability',sp.supplier_availability,'discontinued',sp.discontinued,'sellable',sp.sellable,
  'fulfilment_type',sp.fulfilment_type,'retail_price_minor',sp.retail_price_minor,
  'club_product_id',sp.club_product_id,'club_product_name',cp.name
) order by s.name,sp.name),'[]'::jsonb)
from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id
left join public.club_commerce_products cp on cp.id=sp.club_product_id
where sp.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_list_supplier_catalogue(uuid) from public,anon; grant execute on function public.club_list_supplier_catalogue(uuid) to authenticated;

create or replace function public.club_publish_supplier_offer(p_organisation_id uuid,p_offer_id uuid,p_club_product_id uuid,p_retail_price_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype; product public.club_commerce_products%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue publication is not permitted' using errcode='42501'; end if;
 if p_retail_price_minor is null or p_retail_price_minor<=0 then raise exception 'A positive retail price is required' using errcode='22023'; end if;
 select * into offer from public.club_supplier_products where id=p_offer_id and organisation_id=p_organisation_id for update;
 select * into product from public.club_commerce_products where id=p_club_product_id and organisation_id=p_organisation_id and active for update;
 if not found or offer.id is null or offer.discontinued then raise exception 'Product review is incomplete' using errcode='P0002'; end if;
 if exists(select 1 from public.club_supplier_products other where other.organisation_id=p_organisation_id and other.club_product_id=p_club_product_id and other.id<>p_offer_id and other.sellable and not other.discontinued and other.fulfilment_type='supplier_order_for_collection') then raise exception 'Choose one supplier offer for this product' using errcode='22023'; end if;
 update public.club_supplier_products set club_product_id=p_club_product_id,retail_price_minor=p_retail_price_minor,sellable=true,fulfilment_type='supplier_order_for_collection',updated_at=now() where id=p_offer_id returning * into offer;
 return jsonb_build_object('id',offer.id,'club_product_id',offer.club_product_id,'retail_price_minor',offer.retail_price_minor,'sellable',offer.sellable);
end; $$;
revoke all on function public.club_publish_supplier_offer(uuid,uuid,uuid,integer) from public,anon; grant execute on function public.club_publish_supplier_offer(uuid,uuid,uuid,integer) to authenticated;

create or replace function public.club_create_and_publish_supplier_product(p_organisation_id uuid,p_offer_id uuid,p_name text,p_brand text,p_category text,p_barcode text,p_retail_price_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype; product public.club_commerce_products%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue publication is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_name),'') is null or p_retail_price_minor is null or p_retail_price_minor<=0 then raise exception 'Product name and positive retail price are required' using errcode='22023'; end if;
 select * into offer from public.club_supplier_products where id=p_offer_id and organisation_id=p_organisation_id and not discontinued for update;
 if not found then raise exception 'Supplier product not found' using errcode='P0002'; end if;
 insert into public.club_commerce_products(organisation_id,barcode,name,brand,category,active,stock_tracked,sell_price_minor,currency,media)
 values(p_organisation_id,nullif(btrim(p_barcode),''),btrim(p_name),nullif(btrim(p_brand),''),nullif(btrim(p_category),''),true,false,p_retail_price_minor,'GBP',null)
 returning * into product;
 update public.club_supplier_products set club_product_id=product.id,retail_price_minor=p_retail_price_minor,sellable=true,fulfilment_type='supplier_order_for_collection',updated_at=now() where id=offer.id;
 return jsonb_build_object('id',offer.id,'club_product_id',product.id,'retail_price_minor',p_retail_price_minor,'sellable',true);
end; $$;
revoke all on function public.club_create_and_publish_supplier_product(uuid,uuid,text,text,text,text,integer) from public,anon; grant execute on function public.club_create_and_publish_supplier_product(uuid,uuid,text,text,text,text,integer) to authenticated;

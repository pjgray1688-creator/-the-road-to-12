-- Keep supplier-derived default retail prices aligned with R12's whole-pound pricing rule.
create or replace function public.club_link_supplier_catalogue_to_commerce(p_organisation_id uuid, p_supplier_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; pp public.club_supplier_parent_products%rowtype; sp public.club_supplier_products%rowtype; f public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; v_price integer; v_created integer:=0; v_updated integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name)=lower(btrim(p_supplier_name)) limit 1;
  if not found then return jsonb_build_object('created',0,'updated',0); end if;
  for pp in select * from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and archived_at is null loop
    insert into public.club_product_families(organisation_id,name,brand,description,category,media,active)
    values(p_organisation_id,pp.name,pp.brand,pp.description,pp.category,case when pp.parent_image_url is null then null else jsonb_build_object('url',pp.parent_image_url) end,true)
    on conflict (organisation_id,name) do update set brand=coalesce(excluded.brand,club_product_families.brand),description=coalesce(excluded.description,club_product_families.description),media=coalesce(excluded.media,club_product_families.media),updated_at=now()
    returning * into f;
    for sp in select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and parent_product_id=pp.id and not discontinued loop
      v_price:=case when sp.trade_cost_ex_vat_minor is not null then ceil(round(sp.trade_cost_ex_vat_minor*(1+coalesce(sp.supplied_vat_rate,0.2)))/70.0)*100 else 0 end;
      select * into cp from public.club_commerce_products where organisation_id=p_organisation_id and supplier_reference='supplier_product:'||sp.id::text limit 1;
      if found then
        update public.club_commerce_products set family_id=f.id,variant_options=jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit),description=coalesce(sp.description,club_commerce_products.description),media=case when sp.variant_image_url is null then media else jsonb_build_object('url',sp.variant_image_url) end,active=not sp.discontinued,updated_at=now(),sell_price_minor=case when sell_price_minor=0 then v_price else sell_price_minor end where id=cp.id;
        v_updated:=v_updated+1;
      else
        insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,supplier_reference,media,family_id,variant_options)
        values(p_organisation_id,case when sp.supplier_sku is not null and not exists(select 1 from public.club_commerce_products x where x.organisation_id=p_organisation_id and x.sku=sp.supplier_sku) then sp.supplier_sku else null end,sp.barcode,pp.name,pp.brand,sp.description,pp.category,not sp.discontinued,false,v_price,sp.trade_cost_ex_vat_minor,'GBP','supplier_product:'||sp.id::text,case when sp.variant_image_url is null then null else jsonb_build_object('url',sp.variant_image_url) end,f.id,jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit)) returning * into cp;
        v_created:=v_created+1;
      end if;
      update public.club_supplier_products set club_product_id=cp.id where id=sp.id and club_product_id is distinct from cp.id;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_link_supplier_catalogue_to_commerce(uuid,text) from public,anon;
grant execute on function public.club_link_supplier_catalogue_to_commerce(uuid,text) to authenticated;

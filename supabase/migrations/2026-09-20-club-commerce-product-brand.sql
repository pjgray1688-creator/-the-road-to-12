-- Optional retail brand, kept separate from the product name.
-- Review and execute in the target environment; never run from the app.
alter table public.club_commerce_products add column if not exists brand text;
alter table public.club_commerce_products add constraint club_commerce_products_brand_length check (brand is null or length(btrim(brand)) between 1 and 120);

drop function if exists public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb);
create or replace function public.club_save_commerce_product(p_id uuid,p_organisation_id uuid,p_sku text,p_barcode text,p_name text,p_brand text,p_description text,p_category text,p_active boolean,p_stock_tracked boolean,p_sell_price_minor integer,p_cost_price_minor integer,p_currency text,p_tax_code text,p_supplier_reference text,p_media jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_commerce_products%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Commerce catalogue administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or p_brand is not null and length(btrim(p_brand))>120 or p_sell_price_minor<0 or (p_cost_price_minor is not null and p_cost_price_minor<0) or p_currency !~ '^[A-Z]{3}$' or p_media is not null and jsonb_typeof(p_media)<>'object' then raise exception 'Invalid commerce product input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,tax_code,supplier_reference,media)
    values(p_organisation_id,nullif(btrim(p_sku),''),nullif(btrim(p_barcode),''),btrim(p_name),nullif(btrim(p_brand),''),p_description,nullif(btrim(p_category),''),p_active,p_stock_tracked,p_sell_price_minor,p_cost_price_minor,p_currency,p_tax_code,p_supplier_reference,p_media) returning * into v_row;
  else
    update public.club_commerce_products set sku=nullif(btrim(p_sku),''),barcode=nullif(btrim(p_barcode),''),name=btrim(p_name),brand=nullif(btrim(p_brand),''),description=p_description,category=nullif(btrim(p_category),''),active=p_active,stock_tracked=p_stock_tracked,sell_price_minor=p_sell_price_minor,cost_price_minor=p_cost_price_minor,currency=p_currency,tax_code=p_tax_code,supplier_reference=p_supplier_reference,media=p_media,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb) from public,anon;
grant execute on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb) to authenticated;

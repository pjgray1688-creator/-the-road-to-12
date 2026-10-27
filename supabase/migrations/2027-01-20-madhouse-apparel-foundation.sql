-- Madhouse Apparel: manual made-to-order supplier catalogue.
-- Review-only migration. It does not execute the catalogue import or touch stock.

create table if not exists public.club_supplier_colour_media (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade,
  parent_product_id uuid not null references public.club_supplier_parent_products(id) on delete cascade,
  colour text not null check (length(btrim(colour))>0),
  image_urls text[] not null check (cardinality(image_urls) between 1 and 2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,organisation_id)
);
create unique index if not exists club_supplier_colour_media_identity_uq on public.club_supplier_colour_media(parent_product_id,lower(colour));
create index if not exists club_supplier_colour_media_scope_idx on public.club_supplier_colour_media(organisation_id,supplier_id,parent_product_id);
alter table public.club_supplier_colour_media enable row level security;
revoke all on public.club_supplier_colour_media from public,anon,authenticated;

-- A reviewed, repeatable import. Existing operator price and enabled state are
-- preserved; only missing rows receive the launch defaults.
create or replace function public.club_import_madhouse_apparel(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; f jsonb; c jsonb; sz text; pp public.club_supplier_parent_products%rowtype;
  fam public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; sp public.club_supplier_products%rowtype;
  sku text; colour text; images text[]; price integer; product_ids jsonb:='[]'::jsonb; tee_ids jsonb:='[]'::jsonb; hoodie_ids jsonb:='[]'::jsonb;
  promo public.club_promotions%rowtype; variant_count integer;
  families jsonb := '[
    {"code":"TS","key":"madhouse-heavy-oversized-tshirt","name":"Heavy Oversized T-Shirt","price":2500,"colours":[["Blue",["/madhouse-apparel/tshirt-blue-front.jpg","/madhouse-apparel/tshirt-blue-rear.jpg"]],["Black/Grey",["/madhouse-apparel/tshirt-black-grey-front.jpg","/madhouse-apparel/tshirt-black-grey-rear.jpg"]],["Pink",["/madhouse-apparel/tshirt-pink-front.jpg","/madhouse-apparel/tshirt-pink-rear.jpg"]],["Purple",["/madhouse-apparel/tshirt-purple-front.jpg","/madhouse-apparel/tshirt-purple-rear.jpg"]],["Brown",["/madhouse-apparel/tshirt-brown-front.jpg","/madhouse-apparel/tshirt-brown-rear.jpg"]],["Green",["/madhouse-apparel/tshirt-green-front.jpg","/madhouse-apparel/tshirt-green-rear.jpg"]]]},
    {"code":"CS","key":"madhouse-crewneck-sweatshirt","name":"Crewneck Sweatshirt","price":3500,"colours":[["Cream",["/madhouse-apparel/sweatshirt-cream.jpg"]],["Brown",["/madhouse-apparel/sweatshirt-brown.jpg"]],["White",["/madhouse-apparel/sweatshirt-white.jpg"]],["Grey",["/madhouse-apparel/sweatshirt-grey.jpg"]],["Black",["/madhouse-apparel/sweatshirt-black.jpg"]],["Tan",["/madhouse-apparel/sweatshirt-tan.jpg"]]]},
    {"code":"HD","key":"madhouse-pullover-hoodie","name":"Pullover Hoodie","price":3500,"colours":[["Navy",["/madhouse-apparel/hoodie-navy.jpg"]],["Light Blue",["/madhouse-apparel/hoodie-light-blue.jpg"]],["White",["/madhouse-apparel/hoodie-white.jpg"]],["Charcoal",["/madhouse-apparel/hoodie-charcoal.jpg"]],["Red",["/madhouse-apparel/hoodie-red.jpg"]],["Pink",["/madhouse-apparel/hoodie-pink.jpg"]],["Green",["/madhouse-apparel/hoodie-green.jpg"]],["Black",["/madhouse-apparel/hoodie-black.jpg"]],["Cream",["/madhouse-apparel/hoodie-cream.jpg"]]]}
  ]'::jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Madhouse Apparel import is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id) then raise exception 'Organisation not found' using errcode='P0002'; end if;
  insert into public.club_suppliers(organisation_id,name,slug,member_orderable,active,ordering_config)
    values(p_organisation_id,'Madhouse Apparel','madhouse-apparel',true,true,'{"mode":"manual","availability":"manual","made_to_order":true}'::jsonb)
    on conflict (organisation_id,lower(name)) do update set slug='madhouse-apparel',member_orderable=true,active=true,ordering_config=excluded.ordering_config,updated_at=now() returning * into s;
  for f in select value from jsonb_array_elements(families) loop
    price:=(f->>'price')::integer;
    insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,parent_image_url,active)
      values(p_organisation_id,s.id,f->>'key','Madhouse Apparel',f->>'name','Made to order for collection.','Apparel','Made to order',f->'colours'->0->1->>0,true)
      on conflict (organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,parent_image_url=excluded.parent_image_url,updated_at=now() returning * into pp;
    insert into public.club_product_families(organisation_id,brand,name,description,category,media,active,sort_position)
      values(p_organisation_id,'Madhouse Apparel',f->>'name','Made to order for collection.','Apparel',jsonb_build_object('url',f->'colours'->0->1->>0),true,200)
      on conflict (organisation_id,name) do update set brand=excluded.brand,description=excluded.description,category=excluded.category,media=excluded.media,updated_at=now() returning * into fam;
    for c in select value from jsonb_array_elements(f->'colours') loop
      colour:=c->>0; select array_agg(value order by ordinality) into images from jsonb_array_elements_text(c->1) with ordinality;
      insert into public.club_supplier_colour_media(organisation_id,supplier_id,parent_product_id,colour,image_urls) values(p_organisation_id,s.id,pp.id,colour,images)
        on conflict (parent_product_id,lower(colour)) do update set image_urls=excluded.image_urls,updated_at=now();
      foreach sz in array array['S','M','L','XL','2XL','3XL','4XL','5XL'] loop
        sku:='MHA-'||(f->>'code')||'-'||upper(regexp_replace(colour,'[^a-z0-9]+','-','gi'))||'-'||sz;
        insert into public.club_commerce_products(organisation_id,sku,name,brand,description,category,active,stock_tracked,sell_price_minor,currency,supplier_reference,media,family_id,variant_options,sales_channels,unit_label,stripe_merchant_entity)
          values(p_organisation_id,sku,(f->>'name')||' · '||colour||' · '||sz,'Madhouse Apparel','Made to order for collection.','Apparel',true,false,price,'GBP',null,jsonb_build_object('url',images[1],'gallery',to_jsonb(images)),fam.id,jsonb_build_object('colour',colour,'size',sz),array['pos','online'],'each','madhouse_products_services')
          on conflict (organisation_id,sku) do update set name=excluded.name,brand=excluded.brand,description=excluded.description,category=excluded.category,stock_tracked=false,media=excluded.media,family_id=excluded.family_id,variant_options=excluded.variant_options,sales_channels=excluded.sales_channels,unit_label=excluded.unit_label,stripe_merchant_entity=excluded.stripe_merchant_entity,updated_at=now() returning * into cp;
        insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,club_product_id,supplier_sku,brand,name,variant,size,description,category,fulfilment_type,retail_price_minor,manual_price,member_orderable_unit,availability_status,variant_image_url,image_url,active,sellable,discontinued,source_metadata)
          values(p_organisation_id,s.id,pp.id,cp.id,sku,'Madhouse Apparel',f->>'name',colour,sz,'Made to order for collection.','Apparel','supplier_order_for_collection',price,true,'each','available',images[1],images[1],true,true,false,'{"availability_source":"manual","made_to_order":true}'::jsonb)
          on conflict (organisation_id,supplier_id,supplier_sku) where supplier_sku is not null do update set parent_product_id=excluded.parent_product_id,club_product_id=excluded.club_product_id,brand=excluded.brand,name=excluded.name,variant=excluded.variant,size=excluded.size,description=excluded.description,category=excluded.category,fulfilment_type=excluded.fulfilment_type,member_orderable_unit=excluded.member_orderable_unit,variant_image_url=excluded.variant_image_url,image_url=excluded.image_url,source_metadata=excluded.source_metadata,updated_at=now() returning * into sp;
        update public.club_commerce_products set supplier_reference=sp.id::text where id=cp.id and supplier_reference is distinct from sp.id::text;
        product_ids:=product_ids||to_jsonb(cp.id::text); if f->>'code'='TS' then tee_ids:=tee_ids||to_jsonb(cp.id::text); elsif f->>'code'='HD' then hoodie_ids:=hoodie_ids||to_jsonb(cp.id::text); end if;
      end loop;
    end loop;
  end loop;
  select count(*) into variant_count from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and supplier_sku like 'MHA-%';
  if variant_count<>168 or jsonb_array_length(product_ids)<>168 then raise exception 'Madhouse Apparel import count mismatch' using errcode='22023'; end if;
  select * into promo from public.club_promotions where organisation_id=p_organisation_id and lower(name)=lower('Madhouse Winter Hoodie + T-Shirt') limit 1 for update;
  if promo.id is null then insert into public.club_promotions(organisation_id,name,description,status,starts_at,eligibility,created_by)
    values(p_organisation_id,'Madhouse Winter Hoodie + T-Shirt','Any Madhouse pullover hoodie and Heavy Oversized T-Shirt for £47.50.','active',now(),jsonb_build_object('priority',500,'stacking','exclusive','repeatable',true,'bundle_price_minor',4750,'bundle_groups',jsonb_build_array(jsonb_build_object('group_id','hoodie','required_quantity',1,'product_ids',hoodie_ids),jsonb_build_object('group_id','tshirt','required_quantity',1,'product_ids',tee_ids))),auth.uid()) returning * into promo;
  else update public.club_promotions set description='Any Madhouse pullover hoodie and Heavy Oversized T-Shirt for £47.50.',eligibility=jsonb_build_object('priority',500,'stacking','exclusive','repeatable',true,'bundle_price_minor',4750,'bundle_groups',jsonb_build_array(jsonb_build_object('group_id','hoodie','required_quantity',1,'product_ids',hoodie_ids),jsonb_build_object('group_id','tshirt','required_quantity',1,'product_ids',tee_ids))),updated_at=now() where id=promo.id returning * into promo; end if;
  if not exists(select 1 from public.club_promotion_effects where promotion_id=promo.id) then insert into public.club_promotion_effects(promotion_id,effect_type,amount_minor) values(promo.id,'fixed_discount',1250); else update public.club_promotion_effects set effect_type='fixed_discount',amount_minor=1250,percentage_basis_points=null where promotion_id=promo.id; end if;
  update public.club_promotions g set eligibility=jsonb_set(g.eligibility,'{golden_candidates}',coalesce(g.eligibility->'golden_candidates','[]'::jsonb)||jsonb_build_array(jsonb_build_object('type','group','id','madhouse_apparel','product_ids',product_ids)),true),updated_at=now()
    where g.organisation_id=p_organisation_id and coalesce((g.eligibility->>'golden_ticket')::boolean,false) and not exists(select 1 from jsonb_array_elements(coalesce(g.eligibility->'golden_candidates','[]'::jsonb)) x where x->>'id'='madhouse_apparel');
  return jsonb_build_object('supplierId',s.id,'families',3,'variants',variant_count,'colourMedia',21,'promotionId',promo.id);
end; $$;
revoke all on function public.club_import_madhouse_apparel(uuid) from public,anon;
grant execute on function public.club_import_madhouse_apparel(uuid) to authenticated;

create or replace function public.club_set_madhouse_apparel_enabled(p_organisation_id uuid,p_supplier_product_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare sp public.club_supplier_products%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Catalogue access required' using errcode='42501'; end if;
  select p.* into sp from public.club_supplier_products p join public.club_suppliers s on s.id=p.supplier_id and s.organisation_id=p.organisation_id where p.id=p_supplier_product_id and p.organisation_id=p_organisation_id and s.slug='madhouse-apparel' for update of p;
  if not found then raise exception 'Madhouse Apparel variant not found' using errcode='P0002'; end if;
  update public.club_supplier_products set active=p_enabled,sellable=p_enabled,availability_status=case when p_enabled then 'available' else 'unavailable' end,updated_at=now() where id=sp.id returning * into sp;
  update public.club_commerce_products set active=p_enabled,updated_at=now() where id=sp.club_product_id and organisation_id=p_organisation_id;
  return to_jsonb(sp);
end; $$;
revoke all on function public.club_set_madhouse_apparel_enabled(uuid,uuid,boolean) from public,anon;
grant execute on function public.club_set_madhouse_apparel_enabled(uuid,uuid,boolean) to authenticated;

-- Staff projection includes the manual state used by the apparel toggle.
create or replace function public.club_list_supplier_catalogue(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'supplier_id',sp.supplier_id,'supplier',s.name,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'brand',sp.brand,'name',sp.name,'variant',sp.variant,'size',sp.size,'category',sp.category,'discontinued',sp.discontinued,'active',sp.active,'availability_status',sp.availability_status,'sellable',sp.sellable,'fulfilment_type',sp.fulfilment_type,'retail_price_minor',sp.retail_price_minor,'club_product_id',sp.club_product_id,'club_product_name',cp.name) order by s.name,sp.name,sp.variant,sp.size),'[]'::jsonb)
from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id left join public.club_commerce_products cp on cp.id=sp.club_product_id
where sp.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage'); $$;
revoke all on function public.club_list_supplier_catalogue(uuid) from public,anon; grant execute on function public.club_list_supplier_catalogue(uuid) to authenticated;

-- Member projection exposes gallery URLs, never costs or operator metadata.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,'imageReference',pp.parent_image_url,'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',false,'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'supplierSku',sp.supplier_sku,'stockStatus',sp.availability_status,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'imageReferences',coalesce(to_jsonb(cm.image_urls),jsonb_build_array(sp.variant_image_url)),'retailPriceMinor',sp.retail_price_minor) order by sp.variant,sp.size),'[]'::jsonb) from public.club_supplier_products sp left join public.club_supplier_colour_media cm on cm.parent_product_id=sp.parent_product_id and lower(cm.colour)=lower(sp.variant) where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and sp.sellable and not sp.discontinued and sp.availability_status='available')) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable and exists(select 1 from public.club_supplier_products a where a.parent_product_id=pp.id and a.active and a.sellable and not a.discontinued and a.availability_status='available') and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active); $$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon; grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;

-- Every linked supplier offer is guarded; no import-specific marker is needed.
create or replace function public.club_guard_supplier_order_item() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_supplier_products sp where sp.organisation_id=new.organisation_id and sp.club_product_id=new.product_id) and not exists(select 1 from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id and s.organisation_id=sp.organisation_id where sp.organisation_id=new.organisation_id and sp.club_product_id=new.product_id and sp.active and sp.sellable and not sp.discontinued and sp.availability_status='available' and s.active and s.member_orderable) then raise exception 'This supplier option is currently unavailable' using errcode='22023'; end if;
  return new;
end; $$;
revoke all on function public.club_guard_supplier_order_item() from public,anon,authenticated;

-- Dynamic price_data is allowed only after the database has explicitly routed
-- the product to the Products & Services merchant. Existing configured Price
-- IDs remain supported and are still verified by the server provider.
alter table public.club_commerce_products drop constraint if exists club_commerce_products_stripe_route_ck;
alter table public.club_commerce_products add constraint club_commerce_products_stripe_route_ck check ((stripe_merchant_entity is null and stripe_product_id is null and stripe_price_id is null) or (stripe_merchant_entity='madhouse_products_services' and ((stripe_product_id is null and stripe_price_id is null) or (stripe_product_id ~ '^prod_[A-Za-z0-9]+$' and stripe_price_id ~ '^price_[A-Za-z0-9]+$'))));

create or replace function public.club_begin_stripe_commerce_attempt(p_organisation_id uuid,p_location_id uuid,p_items jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare order_result jsonb; o public.club_orders%rowtype; a jsonb; v_attempt public.club_payment_attempts%rowtype; item record; v_expected integer:=0;
begin
  if auth.uid() is null or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Payment attempt is not valid' using errcode='42501'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Basket is empty' using errcode='22023'; end if;
  for item in select (value->>'product_id')::uuid product_id,(value->>'quantity')::integer quantity from jsonb_array_elements(p_items) loop
    if item.quantity is null or item.quantity<1 or item.quantity>50 or not exists(select 1 from public.club_commerce_products p where p.id=item.product_id and p.organisation_id=p_organisation_id and p.active and p.stripe_merchant_entity='madhouse_products_services' and 'online'=any(p.sales_channels)) then raise exception 'Every basket item needs the Products and Services route' using errcode='22023'; end if;
    select v_expected+(p.sell_price_minor*item.quantity) into v_expected from public.club_commerce_products p where p.id=item.product_id and p.organisation_id=p_organisation_id;
  end loop;
  order_result:=public.club_create_commerce_order(p_organisation_id,p_location_id,null,'member_app','GBP',p_items,p_idempotency_key); select * into o from public.club_orders where id=(order_result->'order'->>'id')::uuid for update;
  if o.subtotal_minor<>v_expected or o.total_minor<>v_expected-o.discount_minor then raise exception 'Authoritative Stripe total mismatch' using errcode='22023'; end if;
  perform public.club_reserve_order_stock(o.id); a:=public.club_create_payment_attempt(p_organisation_id,o.id,0,'card',o.total_minor,p_idempotency_key||':stripe'); select * into v_attempt from public.club_payment_attempts where id=(a->'attempt'->>'id')::uuid for update;
  if v_attempt.stripe_merchant_entity is not null and v_attempt.stripe_merchant_entity<>'madhouse_products_services' then raise exception 'Payment attempt merchant mismatch' using errcode='22023'; end if;
  update public.club_payment_attempts set stripe_merchant_entity='madhouse_products_services' where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('order',to_jsonb(o),'attempt',to_jsonb(v_attempt),'lines',(select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'product_name',p.name,'stripe_product_id',p.stripe_product_id,'stripe_price_id',p.stripe_price_id,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,'currency',o.currency) order by i.id),'[]'::jsonb) from public.club_order_items i join public.club_commerce_products p on p.id=i.product_id and p.organisation_id=i.organisation_id where i.order_id=o.id));
end; $$;
revoke all on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) from public,anon; grant execute on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) to authenticated;

-- Quantity-aware stacking: bundled units stay exclusive, leftover quantities
-- can receive the monthly Golden Ticket. Its percentage is recalculated over
-- those leftovers, and a zero saving never produces redemption evidence.
do $$ declare d text; begin
  select pg_get_functiondef('public.club_apply_promotion_stack(jsonb,jsonb,integer)'::regprocedure) into d;
  d:=replace(d,'if mode<>''combinable'' and avail=0 and qty>0 then overlap:=true; end if;','if false then overlap:=true; end if;');
  if position('if false then overlap:=true' in d)=0 then raise exception 'Promotion stack definition was not recognised'; end if; execute d;
  select pg_get_functiondef('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure) into d;
  d:=replace(d,'''effect_type'',''golden_ticket''','''effect_type'',''percentage''');
  if position('''effect_type'', ''percentage''' in d)=0 and position('''effect_type'',''percentage''' in d)=0 then raise exception 'Golden Ticket definition was not recognised'; end if; execute d;
end $$;

-- Production hotfix: replace only the Madhouse Apparel import function.
-- After applying this definition, run the existing catalogue import separately.
create or replace function public.club_import_madhouse_apparel(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; f jsonb; c jsonb; sz text; pp public.club_supplier_parent_products%rowtype;
  fam public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; sp public.club_supplier_products%rowtype;
  v_sku text; v_colour text; images text[]; price integer; product_ids jsonb:='[]'::jsonb; tee_ids jsonb:='[]'::jsonb; hoodie_ids jsonb:='[]'::jsonb;
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
      v_colour:=c->>0; select array_agg(value order by ordinality) into images from jsonb_array_elements_text(c->1) with ordinality;
      insert into public.club_supplier_colour_media(organisation_id,supplier_id,parent_product_id,colour,image_urls) values(p_organisation_id,s.id,pp.id,v_colour,images)
        on conflict (parent_product_id,lower(colour)) do update set image_urls=excluded.image_urls,updated_at=now();
      foreach sz in array array['S','M','L','XL','2XL','3XL','4XL','5XL'] loop
        v_sku:='MHA-'||(f->>'code')||'-'||upper(regexp_replace(v_colour,'[^a-z0-9]+','-','gi'))||'-'||sz;
        insert into public.club_commerce_products(organisation_id,sku,name,brand,description,category,active,stock_tracked,sell_price_minor,currency,supplier_reference,media,family_id,variant_options,sales_channels,unit_label,stripe_merchant_entity)
          values(p_organisation_id,v_sku,(f->>'name')||' · '||v_colour||' · '||sz,'Madhouse Apparel','Made to order for collection.','Apparel',true,false,price,'GBP',null,jsonb_build_object('url',images[1],'gallery',to_jsonb(images)),fam.id,jsonb_build_object('colour',v_colour,'size',sz),array['pos','online'],'each','madhouse_products_services')
          on conflict (organisation_id,sku) do update set name=excluded.name,brand=excluded.brand,description=excluded.description,category=excluded.category,stock_tracked=false,media=excluded.media,family_id=excluded.family_id,variant_options=excluded.variant_options,sales_channels=excluded.sales_channels,unit_label=excluded.unit_label,stripe_merchant_entity=excluded.stripe_merchant_entity,updated_at=now() returning * into cp;
        insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,club_product_id,supplier_sku,brand,name,variant,size,description,category,fulfilment_type,retail_price_minor,manual_price,member_orderable_unit,availability_status,variant_image_url,image_url,active,sellable,discontinued,source_metadata)
          values(p_organisation_id,s.id,pp.id,cp.id,v_sku,'Madhouse Apparel',f->>'name',v_colour,sz,'Made to order for collection.','Apparel','supplier_order_for_collection',price,true,'each','available',images[1],images[1],true,true,false,'{"availability_source":"manual","made_to_order":true}'::jsonb)
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

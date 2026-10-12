-- Set-based Active Sports commerce linking for full supplier catalogues.
-- The supplier commercial trigger remains authoritative for price propagation;
-- this linker never writes the protected canonical price column on UPDATE.
create index if not exists club_supplier_products_link_parent_idx
  on public.club_supplier_products(organisation_id,supplier_id,parent_product_id,id)
  where not discontinued;

create index if not exists club_supplier_products_linked_commerce_idx
  on public.club_supplier_products(organisation_id,club_product_id)
  where club_product_id is not null;

create index if not exists club_commerce_products_supplier_reference_idx
  on public.club_commerce_products(organisation_id,supplier_reference)
  where supplier_reference is not null;

create or replace function public.club_link_supplier_catalogue_to_commerce(
  p_organisation_id uuid,
  p_supplier_name text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_supplier_id uuid;
  v_created integer:=0;
  v_updated integer:=0;
begin
  if auth.uid() is null
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then
    raise exception 'Supplier catalogue import is not permitted' using errcode='42501';
  end if;

  select id into v_supplier_id
  from public.club_suppliers
  where organisation_id=p_organisation_id
    and lower(name)=lower(btrim(p_supplier_name));
  if not found then
    return jsonb_build_object('created',0,'updated',0);
  end if;

  -- Serialize retries/imports for this supplier while preserving independent
  -- organisations and suppliers.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organisation_id::text||':commerce-link:'||v_supplier_id::text,0
  ));

  drop table if exists pg_temp._r12_active_sports_link_stage;

  -- One deterministic family upsert for all active, non-archived parents.
  insert into public.club_product_families(
    organisation_id,name,brand,description,category,media,active
  )
  select distinct on (pp.name)
    p_organisation_id,pp.name,pp.brand,pp.description,pp.category,
    case when coalesce(nullif(btrim(pp.parent_image_url),''),'') ~* '^https?://'
      then jsonb_build_object('url',btrim(pp.parent_image_url)) else null end,
    true
  from public.club_supplier_parent_products pp
  where pp.organisation_id=p_organisation_id
    and pp.supplier_id=v_supplier_id
    and pp.active
    and pp.archived_at is null
  order by pp.name,pp.id
  on conflict (organisation_id,name) do update
    set brand=coalesce(excluded.brand,club_product_families.brand),
        description=coalesce(excluded.description,club_product_families.description),
        media=coalesce(excluded.media,club_product_families.media),
        updated_at=now()
    where (club_product_families.brand,club_product_families.description,club_product_families.media)
      is distinct from
      (coalesce(excluded.brand,club_product_families.brand),
       coalesce(excluded.description,club_product_families.description),
       coalesce(excluded.media,club_product_families.media));

  create temporary table _r12_active_sports_link_stage on commit drop as
  select
    sp.id as supplier_product_id,
    pp.id as parent_product_id,
    f.id as family_id,
    sp.supplier_sku,
    sp.barcode,
    pp.name as product_name,
    pp.brand,
    pp.category,
    sp.description,
    sp.size,
    sp.variant,
    sp.pack_quantity,
    sp.member_orderable_unit,
    sp.discontinued,
    sp.manual_price,
    sp.retail_price_minor,
    sp.trade_cost_ex_vat_minor,
    sp.supplied_vat_rate,
    case when sp.trade_cost_ex_vat_minor is not null
      then ceil(round(sp.trade_cost_ex_vat_minor*(1+coalesce(sp.supplied_vat_rate,0.2)))/70.0)*100
      else 0 end as generated_price_minor,
    case when coalesce(nullif(btrim(sp.variant_image_url),''),nullif(btrim(pp.parent_image_url),'')) ~* '^https?://'
      then coalesce(nullif(btrim(sp.variant_image_url),''),nullif(btrim(pp.parent_image_url),''))
      else null end as image_url,
    linked.id as canonical_product_id
  from public.club_supplier_products sp
  join public.club_supplier_parent_products pp
    on pp.id=sp.parent_product_id
   and pp.organisation_id=sp.organisation_id
   and pp.supplier_id=sp.supplier_id
  join public.club_product_families f
    on f.organisation_id=pp.organisation_id
   and f.name=pp.name
  left join lateral (
    select cp.id
    from public.club_commerce_products cp
    where cp.organisation_id=p_organisation_id
      and cp.supplier_reference='supplier_product:'||sp.id::text
    order by cp.id
    limit 1
  ) linked on true
  where sp.organisation_id=p_organisation_id
    and sp.supplier_id=v_supplier_id
    and pp.active
    and pp.archived_at is null
    and not sp.discontinued;

  create unique index _r12_active_sports_link_stage_supplier_uq
    on pg_temp._r12_active_sports_link_stage(supplier_product_id);

  select count(*) filter(where canonical_product_id is null),
         count(*) filter(where canonical_product_id is not null)
  into v_created,v_updated
  from pg_temp._r12_active_sports_link_stage;

  -- Insert only missing canonical sales units. Assign an organisation-unique
  -- SKU to at most one candidate, as the previous row-wise path did.
  with candidates as (
    select st.*,
      row_number() over(partition by st.supplier_sku order by st.supplier_product_id) as sku_rank
    from pg_temp._r12_active_sports_link_stage st
    where st.canonical_product_id is null
  )
  insert into public.club_commerce_products(
    organisation_id,sku,barcode,name,brand,description,category,active,
    stock_tracked,sell_price_minor,cost_price_minor,currency,supplier_reference,
    media,family_id,variant_options
  )
  select
    p_organisation_id,
    case when c.supplier_sku is not null and c.sku_rank=1 and not exists(
      select 1 from public.club_commerce_products existing
      where existing.organisation_id=p_organisation_id and existing.sku=c.supplier_sku
    ) then c.supplier_sku else null end,
    c.barcode,c.product_name,c.brand,c.description,c.category,not c.discontinued,
    false,
    case when c.manual_price then c.retail_price_minor else c.generated_price_minor end,
    c.trade_cost_ex_vat_minor,'GBP','supplier_product:'||c.supplier_product_id::text,
    case when c.image_url is null then null else jsonb_build_object('url',c.image_url) end,
    c.family_id,
    jsonb_build_object('size',c.size,'flavour',c.variant,
      'packQuantity',c.pack_quantity,'orderUnit',c.member_orderable_unit)
  from candidates c;

  -- Refresh generated supplier prices only where a real mismatch exists. The
  -- BEFORE sync trigger retains the existing VAT/margin/rounding calculation;
  -- the AFTER audit trigger propagates through the canonical guard.
  update public.club_supplier_products sp
  set updated_at=clock_timestamp()
  from pg_temp._r12_active_sports_link_stage st,
       public.club_commerce_products cp
  where st.supplier_product_id=sp.id
    and cp.id=st.canonical_product_id
    and cp.organisation_id=p_organisation_id
    and sp.organisation_id=p_organisation_id
    and not sp.manual_price
    and sp.import_identity is not null
    and sp.trade_cost_ex_vat_minor is not null
    and sp.supplied_vat_rate is not null
    and (sp.retail_price_minor is distinct from st.generated_price_minor
      or cp.sell_price_minor is distinct from st.generated_price_minor);

  -- Resolve IDs for newly inserted products in one indexed join.
  update pg_temp._r12_active_sports_link_stage st
  set canonical_product_id=cp.id
  from public.club_commerce_products cp
  where st.canonical_product_id is null
    and cp.organisation_id=p_organisation_id
    and cp.supplier_reference='supplier_product:'||st.supplier_product_id::text;

  if exists(select 1 from pg_temp._r12_active_sports_link_stage where canonical_product_id is null) then
    raise exception 'A supplier variant could not be linked to its canonical sales unit';
  end if;

  -- Update only materially changed, non-price metadata. Protected price and
  -- cost columns are deliberately absent from this UPDATE.
  update public.club_commerce_products cp
  set family_id=st.family_id,
      variant_options=jsonb_build_object('size',st.size,'flavour',st.variant,
        'packQuantity',st.pack_quantity,'orderUnit',st.member_orderable_unit),
      description=coalesce(st.description,cp.description),
      media=case when st.image_url is null then cp.media else jsonb_build_object('url',st.image_url) end,
      active=not st.discontinued,
      updated_at=now()
  from pg_temp._r12_active_sports_link_stage st
  where cp.id=st.canonical_product_id
    and cp.organisation_id=p_organisation_id
    and (cp.family_id,cp.variant_options,cp.description,cp.media,cp.active)
      is distinct from
      (st.family_id,
       jsonb_build_object('size',st.size,'flavour',st.variant,
         'packQuantity',st.pack_quantity,'orderUnit',st.member_orderable_unit),
       coalesce(st.description,cp.description),
       case when st.image_url is null then cp.media else jsonb_build_object('url',st.image_url) end,
       not st.discontinued);

  -- Persist supplier-to-canonical links in one organisation-scoped update.
  update public.club_supplier_products sp
  set club_product_id=st.canonical_product_id
  from pg_temp._r12_active_sports_link_stage st
  where sp.id=st.supplier_product_id
    and sp.organisation_id=p_organisation_id
    and sp.club_product_id is distinct from st.canonical_product_id;

  drop table pg_temp._r12_active_sports_link_stage;
  return jsonb_build_object('created',v_created,'updated',v_updated);
end;
$$;

revoke all on function public.club_link_supplier_catalogue_to_commerce(uuid,text) from public,anon;
grant execute on function public.club_link_supplier_catalogue_to_commerce(uuid,text) to authenticated;

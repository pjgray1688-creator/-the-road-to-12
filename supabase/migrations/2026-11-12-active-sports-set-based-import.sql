-- Set-based replacement for the direct supplier catalogue importer.
-- The public contract is unchanged; rows are staged once and reconciled in bulk.
create or replace function public.club_import_supplier_catalogue_v2(
  p_organisation_id uuid,
  p_supplier_name text,
  p_file_name text,
  p_rows jsonb,
  p_reconcile boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_supplier public.club_suppliers%rowtype;
  v_batch uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_invalid integer := 0;
  v_rows integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.catalogue_manage') then
    raise exception 'Supplier catalogue import is not permitted' using errcode='42501';
  end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name), '') is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Invalid supplier import' using errcode='22023';
  end if;

  insert into public.club_suppliers(organisation_id, name, slug, member_orderable)
  values (p_organisation_id, btrim(p_supplier_name), lower(regexp_replace(btrim(p_supplier_name), '[^a-z0-9]+', '-', 'g')), false)
  on conflict (organisation_id, lower(name)) do update set active=true, updated_at=v_now
  returning * into v_supplier;

  insert into public.club_supplier_import_batches(organisation_id, supplier_id, file_name, imported_by, row_count)
  values (p_organisation_id, v_supplier.id, coalesce(nullif(btrim(p_file_name), ''), 'supplier.csv'), auth.uid(), jsonb_array_length(p_rows))
  returning id into v_batch;

  drop table if exists pg_temp._active_sports_rows;
  drop table if exists pg_temp._active_sports_valid;
  drop table if exists pg_temp._active_sports_resolved;
  drop table if exists pg_temp._active_sports_matches;

  create temporary table _active_sports_rows on commit drop as
  select
    e.ordinal::integer as row_no,
    nullif(btrim(x->>'name'), '') as name,
    nullif(btrim(x->>'brand'), '') as brand,
    nullif(btrim(x->>'parentKey'), '') as supplied_parent_key,
    nullif(btrim(x->>'flavour'), '') as variant,
    nullif(btrim(x->>'size'), '') as size,
    nullif(btrim(x->>'category'), '') as category,
    nullif(btrim(x->>'subcategory'), '') as subcategory,
    nullif(x->>'description', '') as description,
    nullif(btrim(x->>'supplierSku'), '') as supplier_sku,
    nullif(btrim(x->>'barcode'), '') as barcode,
    case when coalesce(x->>'packQuantity','') ~ '^\d+$' then (x->>'packQuantity')::integer else null end as pack_quantity,
    nullif(btrim(x->>'memberOrderableUnit'), '') as member_orderable_unit,
    nullif(btrim(x->>'sourceUrl'), '') as source_url,
    nullif(btrim(x->>'parentImageUrl'), '') as parent_image_url,
    nullif(btrim(x->>'variantImageUrl'), '') as variant_image_url,
    coalesce(nullif(btrim(x->>'availabilityStatus'), ''), 'unknown') as availability_status,
    case when nullif(x->>'availabilityCheckedAt','') is null then null else (x->>'availabilityCheckedAt')::timestamptz end as availability_checked_at,
    case when coalesce(x->>'tradeCostExVatMinor','') ~ '^\d+$' then (x->>'tradeCostExVatMinor')::integer else null end as trade_cost_ex_vat_minor,
    case when coalesce(x->>'suppliedVatRate','') ~ '^\d+(\.\d+)?$' then (x->>'suppliedVatRate')::numeric else null end as supplied_vat_rate,
    coalesce((x->>'discontinued')::boolean, false) as discontinued,
    nullif(x->>'notes', '') as notes
  from jsonb_array_elements(p_rows) with ordinality as e(x, ordinal);

  select count(*) into v_rows from _active_sports_rows;
  select count(*) into v_invalid from _active_sports_rows where name is null;

  -- Keep the first row for an exact canonical identity, matching the existing import semantics.
  create temporary table _active_sports_valid on commit drop as
  select distinct on (q.identity_key) q.*
  from (
    select r.*,
      coalesce(r.supplied_parent_key, lower(r.name)) as parent_key,
      'import:' || md5(lower(coalesce(r.brand,'')) || '|' || lower(r.name) || '|' || lower(coalesce(r.variant,'')) || '|' || lower(coalesce(r.size,'')) || '|' || coalesce(r.pack_quantity,1)::text || '|' || lower(coalesce(r.member_orderable_unit,'unit'))) as identity_key
    from _active_sports_rows r
    where r.name is not null
  ) q
  order by q.identity_key, q.row_no;

  -- Parent families are upserted once per identity, rather than once per input row.
  insert into public.club_supplier_parent_products(
    organisation_id, supplier_id, parent_key, brand, name, description, category, subcategory, source_url, parent_image_url
  )
  select distinct on (parent_key)
    p_organisation_id, v_supplier.id,
    parent_key, brand, name, description, category, subcategory, source_url, parent_image_url
  from _active_sports_valid
  order by parent_key, row_no
  on conflict (organisation_id, supplier_id, parent_key) do update set
    brand=excluded.brand,
    name=excluded.name,
    description=excluded.description,
    category=excluded.category,
    subcategory=excluded.subcategory,
    source_url=excluded.source_url,
    parent_image_url=excluded.parent_image_url,
    updated_at=v_now;

  create temporary table _active_sports_resolved on commit drop as
  select r.*, pp.id as parent_product_id
  from _active_sports_valid r
  join public.club_supplier_parent_products pp
    on pp.organisation_id=p_organisation_id
   and pp.supplier_id=v_supplier.id
   and pp.parent_key=r.parent_key;

  create temporary table _active_sports_matches on commit drop as
  select distinct on (r.identity_key)
    r.identity_key, r.parent_product_id, sp.id as supplier_product_id
  from _active_sports_resolved r
  left join public.club_supplier_products sp
    on sp.organisation_id=p_organisation_id
   and sp.supplier_id=v_supplier.id
   and (
     sp.import_identity=r.identity_key
     or (
       sp.import_identity is null
       and sp.parent_product_id=r.parent_product_id
       and lower(coalesce(sp.brand,''))=lower(coalesce(r.brand,''))
       and lower(sp.name)=lower(r.name)
       and lower(coalesce(sp.variant,''))=lower(coalesce(r.variant,''))
       and lower(coalesce(sp.size,''))=lower(coalesce(r.size,''))
       and coalesce(sp.pack_quantity,1)=coalesce(r.pack_quantity,1)
       and lower(coalesce(sp.member_orderable_unit,'unit'))=lower(coalesce(r.member_orderable_unit,'unit'))
     )
   )
  order by r.identity_key, (sp.import_identity=r.identity_key) desc nulls last, sp.created_at, sp.id;

  update public.club_supplier_products sp
  set parent_product_id=r.parent_product_id,
      import_identity=r.identity_key,
      supplier_sku=r.supplier_sku,
      barcode=r.barcode,
      brand=r.brand,
      name=r.name,
      variant=r.variant,
      size=r.size,
      pack_quantity=r.pack_quantity,
      member_orderable_unit=r.member_orderable_unit,
      description=r.description,
      category=r.category,
      source_url=r.source_url,
      variant_image_url=r.variant_image_url,
      availability_status=r.availability_status,
      availability_checked_at=r.availability_checked_at,
      trade_cost_ex_vat_minor=r.trade_cost_ex_vat_minor,
      supplied_vat_rate=r.supplied_vat_rate,
      discontinued=r.discontinued,
      source_metadata=jsonb_build_object('parent_key',r.parent_key,'notes',r.notes),
      active=true,
      archived_at=null,
      updated_at=v_now
  from _active_sports_resolved r
  join _active_sports_matches m on m.identity_key=r.identity_key and m.supplier_product_id=sp.id;
  get diagnostics v_updated = row_count;

  insert into public.club_supplier_products(
    organisation_id, supplier_id, parent_product_id, import_identity, supplier_sku, barcode, brand, name, variant, size,
    pack_quantity, member_orderable_unit, description, category, source_url, image_url, variant_image_url,
    availability_status, availability_checked_at, trade_cost_ex_vat_minor, supplied_vat_rate, discontinued, source_metadata
  )
  select
    p_organisation_id, v_supplier.id, r.parent_product_id, r.identity_key, r.supplier_sku, r.barcode, r.brand, r.name, r.variant, r.size,
    r.pack_quantity, r.member_orderable_unit, r.description, r.category, r.source_url, r.variant_image_url, r.variant_image_url,
    r.availability_status, r.availability_checked_at, r.trade_cost_ex_vat_minor, r.supplied_vat_rate, r.discontinued,
    jsonb_build_object('parent_key',r.parent_key,'notes',r.notes)
  from _active_sports_resolved r
  left join _active_sports_matches m on m.identity_key=r.identity_key
  where m.supplier_product_id is null;
  get diagnostics v_created = row_count;

  update public.club_supplier_import_batches
  set created_count=v_created, updated_count=v_updated, invalid_count=v_invalid, skipped_count=(v_rows-v_invalid-v_created-v_updated)
  where id=v_batch;

  return jsonb_build_object(
    'supplierId', v_supplier.id,
    'batchId', v_batch,
    'created', v_created,
    'updated', v_updated,
    'invalid', v_invalid,
    'reconciled', p_reconcile
  );
end;
$$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) to authenticated;

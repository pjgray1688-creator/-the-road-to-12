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
  v_parent public.club_supplier_parent_products%rowtype;
  v_offer public.club_supplier_products%rowtype;
  v_row jsonb;
  v_parent_key text;
  v_created integer := 0;
  v_updated integer := 0;
  v_invalid integer := 0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.catalogue_manage') then
    raise exception 'Supplier catalogue import is not permitted' using errcode='42501';
  end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name), '') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Invalid supplier import' using errcode='22023';
  end if;
  insert into public.club_suppliers(organisation_id, name, slug, member_orderable)
  values (p_organisation_id, btrim(p_supplier_name), lower(regexp_replace(btrim(p_supplier_name), '[^a-z0-9]+', '-', 'g')), false)
  on conflict (organisation_id, lower(name)) do update set active=true, updated_at=now()
  returning * into v_supplier;
  insert into public.club_supplier_import_batches(organisation_id, supplier_id, file_name, imported_by, row_count)
  values (p_organisation_id, v_supplier.id, coalesce(nullif(btrim(p_file_name), ''), 'supplier.csv'), auth.uid(), jsonb_array_length(p_rows));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(v_row->>'name'), '') is null then v_invalid := v_invalid + 1; continue; end if;
    v_parent_key := coalesce(nullif(btrim(v_row->>'parentKey'), ''), lower(btrim(v_row->>'name')));
    insert into public.club_supplier_parent_products(organisation_id, supplier_id, parent_key, brand, name, description, category, subcategory, source_url, parent_image_url)
    values (p_organisation_id, v_supplier.id, v_parent_key, nullif(btrim(v_row->>'brand'), ''), btrim(v_row->>'name'), nullif(v_row->>'description', ''), nullif(btrim(v_row->>'category'), ''), nullif(btrim(v_row->>'subcategory'), ''), nullif(v_row->>'sourceUrl', ''), nullif(v_row->>'parentImageUrl', ''))
    on conflict (organisation_id, supplier_id, parent_key) do update set brand=excluded.brand, name=excluded.name, description=excluded.description, category=excluded.category, subcategory=excluded.subcategory, source_url=excluded.source_url, parent_image_url=excluded.parent_image_url, updated_at=now()
    returning * into v_parent;
    select * into v_offer from public.club_supplier_products
    where organisation_id=p_organisation_id and supplier_id=v_supplier.id
      and ((nullif(btrim(v_row->>'supplierSku'), '') is not null and supplier_sku=btrim(v_row->>'supplierSku'))
        or (supplier_sku is null and parent_product_id=v_parent.id and coalesce(variant, '')=coalesce(nullif(btrim(v_row->>'flavour'), ''), '') and coalesce(size, '')=coalesce(nullif(btrim(v_row->>'size'), ''), '')))
    limit 1;
    if v_offer.id is null then
      insert into public.club_supplier_products(organisation_id, supplier_id, parent_product_id, supplier_sku, barcode, brand, name, variant, size, pack_quantity, member_orderable_unit, description, category, source_url, image_url, variant_image_url, availability_status, availability_checked_at, trade_cost_ex_vat_minor, supplied_vat_rate, discontinued, source_metadata)
      values (p_organisation_id, v_supplier.id, v_parent.id, nullif(btrim(v_row->>'supplierSku'), ''), nullif(btrim(v_row->>'barcode'), ''), nullif(btrim(v_row->>'brand'), ''), v_parent.name, nullif(btrim(v_row->>'flavour'), ''), nullif(btrim(v_row->>'size'), ''), nullif(v_row->>'packQuantity', '')::integer, nullif(btrim(v_row->>'memberOrderableUnit'), ''), nullif(v_row->>'description', ''), nullif(btrim(v_row->>'category'), ''), nullif(v_row->>'sourceUrl', ''), nullif(v_row->>'variantImageUrl', ''), nullif(v_row->>'variantImageUrl', ''), coalesce(nullif(v_row->>'availabilityStatus', ''), 'unknown'), nullif(v_row->>'availabilityCheckedAt', '')::timestamptz, nullif(v_row->>'tradeCostExVatMinor', '')::integer, nullif(v_row->>'suppliedVatRate', '')::numeric, coalesce((v_row->>'discontinued')::boolean, false), jsonb_build_object('parent_key', v_parent_key, 'notes', v_row->>'notes'))
      returning * into v_offer;
      v_created := v_created + 1;
    else
      update public.club_supplier_products set parent_product_id=v_parent.id, brand=nullif(btrim(v_row->>'brand'), ''), name=v_parent.name, variant=nullif(btrim(v_row->>'flavour'), ''), size=nullif(btrim(v_row->>'size'), ''), pack_quantity=nullif(v_row->>'packQuantity', '')::integer, member_orderable_unit=nullif(btrim(v_row->>'memberOrderableUnit'), ''), description=nullif(v_row->>'description', ''), category=nullif(btrim(v_row->>'category'), ''), source_url=nullif(v_row->>'sourceUrl', ''), variant_image_url=nullif(v_row->>'variantImageUrl', ''), availability_status=coalesce(nullif(v_row->>'availabilityStatus', ''), 'unknown'), availability_checked_at=nullif(v_row->>'availabilityCheckedAt', '')::timestamptz, trade_cost_ex_vat_minor=nullif(v_row->>'tradeCostExVatMinor', '')::integer, supplied_vat_rate=nullif(v_row->>'suppliedVatRate', '')::numeric, discontinued=coalesce((v_row->>'discontinued')::boolean, false), updated_at=now() where id=v_offer.id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('supplierId', v_supplier.id, 'created', v_created, 'updated', v_updated, 'invalid', v_invalid, 'reconciled', p_reconcile);
end;
$$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) to authenticated;

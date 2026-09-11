-- Replace the legacy supplier-SKU uniqueness rule. A wholesaler may reuse a
-- SKU across brands, flavours and sizes; import_identity is the canonical key.
begin;

drop index if exists public.club_supplier_products_sku_uq;

do $$
declare duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select organisation_id, supplier_id, import_identity
    from public.club_supplier_products
    where import_identity is not null
    group by organisation_id, supplier_id, import_identity
    having count(*) > 1
  ) duplicates;
  if duplicate_count > 0 then
    raise exception 'Cannot install supplier identity uniqueness: % existing duplicate identity groups require reconciliation', duplicate_count;
  end if;
end;
$$;

create unique index if not exists club_supplier_products_identity_uq
  on public.club_supplier_products(organisation_id, supplier_id, import_identity)
  where import_identity is not null;

commit;

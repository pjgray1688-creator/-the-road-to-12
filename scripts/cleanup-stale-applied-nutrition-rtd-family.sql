-- One-time, narrowly scoped cleanup for the stale generic Applied Nutrition
-- RTD family. Preview is the default. This is a psql script, not a migration.
-- It archives rows rather than deleting them so supplier pricing/order history
-- and any downstream foreign-key references remain intact.
--
-- Preview:
--   psql "$SUPABASE_DB_URL" -v organisation_id='<org-uuid>' -f scripts/cleanup-stale-applied-nutrition-rtd-family.sql
-- Apply after reviewing the preview:
--   psql "$SUPABASE_DB_URL" -v organisation_id='<org-uuid>' -v apply=true -f scripts/cleanup-stale-applied-nutrition-rtd-family.sql

\set ON_ERROR_STOP on
\if :{?organisation_id}
\else
  \echo 'Required: pass -v organisation_id=<organisation UUID>'
  \quit
\endif
\if :{?apply}
\else
  \set apply false
\endif

begin;

create temporary table _r12_stale_applied_rtd_parents on commit drop as
select pp.id as parent_id, pp.organisation_id, pp.supplier_id, pp.parent_key,
       pp.brand, pp.name, pp.active as parent_active, pp.archived_at
from public.club_supplier_parent_products pp
join public.club_suppliers s
  on s.id = pp.supplier_id
 and s.organisation_id = pp.organisation_id
where pp.organisation_id = :'organisation_id'::uuid
  and lower(btrim(s.name)) in ('active sports', 'active sports nutrition')
  and lower(btrim(pp.brand)) = 'applied nutrition'
  and btrim(pp.name) = 'High Protein Shake RTD';

create temporary table _r12_stale_applied_rtd_variants on commit drop as
select sp.id as supplier_product_id, sp.organisation_id, sp.supplier_id,
       sp.parent_product_id, sp.club_product_id, sp.supplier_sku, sp.name,
       sp.variant, sp.size, sp.pack_quantity, sp.member_orderable_unit,
       sp.active as variant_active, sp.sellable, sp.availability_status,
       sp.archived_at as variant_archived_at
from public.club_supplier_products sp
join _r12_stale_applied_rtd_parents p
  on p.parent_id = sp.parent_product_id
 and p.organisation_id = sp.organisation_id
 and p.supplier_id = sp.supplier_id;

\echo 'Exact stale-family parent candidates (20G and 42G parents are shown separately):'
select p.organisation_id, s.name as supplier, p.parent_id, p.parent_key,
       p.brand, p.name, p.parent_active, p.archived_at,
       count(v.supplier_product_id)::integer as variant_count
from _r12_stale_applied_rtd_parents p
join public.club_suppliers s on s.id = p.supplier_id
left join _r12_stale_applied_rtd_variants v on v.parent_product_id = p.parent_id
group by p.organisation_id, s.name, p.parent_id, p.parent_key,
         p.brand, p.name, p.parent_active, p.archived_at
order by p.parent_id;

select pp.organisation_id, s.name as supplier, pp.id as parent_id,
       pp.brand, pp.name, pp.active, pp.archived_at, pp.parent_key
from public.club_supplier_parent_products pp
join public.club_suppliers s
  on s.id = pp.supplier_id and s.organisation_id = pp.organisation_id
where pp.organisation_id = :'organisation_id'::uuid
  and lower(btrim(s.name)) in ('active sports', 'active sports nutrition')
  and lower(btrim(pp.brand)) = 'applied nutrition'
  and btrim(pp.name) in ('High Protein Shake RTD 20G', 'High Protein Shake RTD 42G')
order by pp.name, pp.parent_key;

\echo 'Exact child variants and canonical links (no prices, images, or stock are changed):'
select v.organisation_id, v.supplier_product_id, v.supplier_sku,
       v.name, v.size, v.variant, v.pack_quantity, v.member_orderable_unit,
       v.variant_active, v.sellable, v.availability_status,
       v.variant_archived_at, v.club_product_id,
       cp.name as canonical_product_name, cp.active as canonical_active,
       cp.stock_tracked, cp.supplier_reference,
       (select count(*) from public.club_supplier_variant_prices x
        where x.organisation_id = v.organisation_id and x.supplier_product_id = v.supplier_product_id) as price_history_rows,
       (select count(*) from public.club_supplier_variant_costs x
        where x.organisation_id = v.organisation_id and x.supplier_product_id = v.supplier_product_id) as cost_history_rows,
       (select count(*) from public.club_supplier_demand x
        where x.organisation_id = v.organisation_id and x.supplier_product_id = v.supplier_product_id) as demand_rows,
       (select count(*) from public.club_supplier_order_batch_lines x
        where x.supplier_product_id = v.supplier_product_id) as supplier_order_line_rows,
       (select count(*) from public.club_supplier_replenishment_rules x
        where x.organisation_id = v.organisation_id and x.supplier_product_id = v.supplier_product_id) as replenishment_rule_rows,
       (select count(*) from public.club_inventory x
        where x.organisation_id = v.organisation_id and x.product_id = v.club_product_id) as inventory_location_rows,
       (select count(*) from public.club_stock_movements x
        where x.organisation_id = v.organisation_id and x.product_id = v.club_product_id) as stock_movement_rows,
       (select count(*) from public.club_order_items x
        where x.organisation_id = v.organisation_id and x.product_id = v.club_product_id) as commerce_order_item_rows,
       (select count(*) from public.club_supplier_products other
        where other.organisation_id = v.organisation_id
          and other.club_product_id = v.club_product_id
          and other.id <> v.supplier_product_id) as other_supplier_links
from _r12_stale_applied_rtd_variants v
left join public.club_commerce_products cp
  on cp.id = v.club_product_id and cp.organisation_id = v.organisation_id
order by v.supplier_product_id;

\if :apply
  \echo 'APPLY=true: archiving only the exact Applied Nutrition / High Protein Shake RTD family.'

  do $$
  begin
    if exists (
      select 1
      from _r12_stale_applied_rtd_variants v
      join public.club_commerce_products cp
        on cp.id = v.club_product_id and cp.organisation_id = v.organisation_id
      where cp.active
        and (cp.stock_tracked
          or cp.supplier_reference is distinct from ('supplier_product:' || v.supplier_product_id::text)
          or exists (
            select 1 from public.club_supplier_products other
             where other.organisation_id = v.organisation_id
               and other.club_product_id = cp.id
               and other.id <> v.supplier_product_id
          ))
    ) then
      raise exception 'Cleanup stopped: a linked canonical product appears locally stocked or has ambiguous supplier ownership; review the preview before proceeding.';
    end if;
  end
  $$;

  update public.club_supplier_products sp
     set active = false,
         sellable = false,
         availability_status = 'unavailable',
         archived_at = coalesce(sp.archived_at, now()),
         updated_at = now()
    from _r12_stale_applied_rtd_variants v
   where sp.id = v.supplier_product_id
     and sp.organisation_id = v.organisation_id;

  update public.club_supplier_parent_products pp
     set active = false,
         archived_at = coalesce(pp.archived_at, now()),
         updated_at = now()
    from _r12_stale_applied_rtd_parents p
   where pp.id = p.parent_id
     and pp.organisation_id = p.organisation_id
     and pp.supplier_id = p.supplier_id;

  -- Hide only canonical rows whose supplier reference proves they were
  -- generated for one of these variants, are not local-stock products, and
  -- have no other supplier offer. Keep rows with ambiguous/local ownership.
  update public.club_commerce_products cp
     set active = false,
         updated_at = now()
    from _r12_stale_applied_rtd_variants v
   where cp.id = v.club_product_id
     and cp.organisation_id = v.organisation_id
     and cp.supplier_reference = 'supplier_product:' || v.supplier_product_id::text
     and not cp.stock_tracked
     and not exists (
       select 1 from public.club_supplier_products other
        where other.organisation_id = v.organisation_id
          and other.club_product_id = cp.id
          and other.id <> v.supplier_product_id
     );

  \echo 'Cleanup updates completed; committing the soft archive (no row deletion).'
  commit;
\else
  \echo 'PREVIEW ONLY: no changes made. Re-run with -v apply=true only after reviewing every listed row and reference.'
  rollback;
\endif

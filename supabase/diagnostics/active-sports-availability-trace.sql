-- Read-only production diagnostic. Replace :organisation_id and
-- :supplier_product_id in Supabase SQL Editor; do not run as an application
-- migration. This compares the durable supplier row with the shop RPC.
select
  sp.id as supplier_product_id,
  pp.name as parent_name,
  sp.variant,
  sp.size,
  sp.availability_status,
  s.member_orderable,
  sp.club_product_id,
  cp.id as commerce_product_id,
  cp.supplier_reference,
  cp.media,
  coalesce((select sum(sm.quantity_delta) from public.club_stock_movements sm
            where sm.organisation_id = sp.organisation_id
              and sm.product_id = coalesce(sp.local_product_id, sp.club_product_id)), 0) as local_on_hand
from public.club_supplier_products sp
join public.club_supplier_parent_products pp on pp.id = sp.parent_product_id
join public.club_suppliers s on s.id = sp.supplier_id
left join public.club_commerce_products cp on cp.id = sp.club_product_id
where sp.organisation_id = :organisation_id
  and sp.id = :supplier_product_id;

-- Run while authenticated as the target member/staff user to compare the
-- returned durable parent/variant payload (including stockStatus):
-- select public.club_list_member_supplier_catalogue(:organisation_id, null);

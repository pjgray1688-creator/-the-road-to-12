-- Member-safe enrichment read model. No operator provenance, cost or ledger data.
create or replace function public.club_list_member_supplier_enrichment(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('variantId',e.supplier_product_id,'description',e.description,'nutrition',e.nutrition,'ingredients',e.ingredients,'allergens',e.allergens,'parentImageUrl',e.parent_image_url,'variantImageUrl',e.variant_image_url)), '[]'::jsonb)
from public.club_supplier_variant_enrichment e
where e.organisation_id=p_organisation_id and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_enrichment(uuid) from public,anon;
grant execute on function public.club_list_member_supplier_enrichment(uuid) to authenticated;

-- Consumer member boundary. This deliberately resolves memberships from auth.uid()
-- and never accepts a member/customer id from the browser.
create or replace function public.club_list_my_memberships()
returns setof jsonb
language sql stable security definer set search_path=pg_catalog,public
as $$
  select jsonb_build_object(
    'organisation', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'active', o.active, 'branding', o.branding),
    'membership', jsonb_build_object('id', m.id, 'product_name', p.name, 'status', m.status, 'starts_at', m.starts_at, 'ends_at', m.ends_at)
  )
  from public.club_membership_holders h
  join public.club_memberships m on m.id = h.membership_id
  join public.club_products p on p.id = m.product_id and p.organisation_id = m.organisation_id
  join public.club_organisations o on o.id = m.organisation_id
  where auth.uid() is not null and h.user_id = auth.uid() and o.active
  order by o.name, m.starts_at desc;
$$;
revoke all on function public.club_list_my_memberships() from public, anon;
grant execute on function public.club_list_my_memberships() to authenticated;

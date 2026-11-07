-- The Madhouse Members directory represents actual membership holders, not
-- every R12 Club role or customer row. Historical membership records remain
-- visible; staff/Coach access is not treated as a membership.
begin;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member directory is not permitted' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',m.id,'user_id',m.user_id,'customer_id',c.id,'role',m.role,'active',m.active,
      'display_name',coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),
      'email',coalesce(nullif(c.email,''),nullif(p.email,'')),
      'membership_name',history.product_name,'membership_status',history.status,'membership_ends_at',history.ends_at,
      'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,
      'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')
    ) order by coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),m.created_at)
    from public.club_members m
    left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id
    left join public.profiles p on p.id=m.user_id
    left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id
    left join lateral (
      select product.name product_name,ms.status,ms.ends_at
      from public.club_memberships ms
      join public.club_products product on product.id=ms.product_id and product.organisation_id=ms.organisation_id
      join public.club_membership_holders h on h.membership_id=ms.id and h.organisation_id=ms.organisation_id
      left join public.club_customers hc on hc.id=h.customer_id and hc.organisation_id=h.organisation_id
      where ms.organisation_id=p_organisation_id
        and (h.user_id=m.user_id or hc.user_id=m.user_id or (c.id is not null and h.customer_id=c.id))
      order by case ms.status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 when 'suspended' then 2 when 'expired' then 3 when 'cancelled' then 4 else 5 end,
        ms.starts_at desc,ms.created_at desc
      limit 1
    ) history on true
    where m.organisation_id=p_organisation_id and m.user_id is not null
      and exists(
        select 1 from public.club_memberships ms
        join public.club_membership_holders h on h.membership_id=ms.id and h.organisation_id=ms.organisation_id
        left join public.club_customers hc on hc.id=h.customer_id and hc.organisation_id=h.organisation_id
        where ms.organisation_id=m.organisation_id and (h.user_id=m.user_id or hc.user_id=m.user_id)
      )
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.club_list_member_summaries(uuid) from public,anon;
grant execute on function public.club_list_member_summaries(uuid) to authenticated;

create or replace function public.club_list_unlinked_membership_customers(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Member directory is not permitted' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'display_name',c.display_name,'email',c.email,
      'membership_name',history.product_name,'membership_status',history.status,'membership_ends_at',history.ends_at
    ) order by c.display_name,c.created_at)
    from public.club_customers c
    join lateral (
      select product.name product_name,ms.status,ms.ends_at
      from public.club_membership_holders h
      join public.club_memberships ms on ms.id=h.membership_id and ms.organisation_id=h.organisation_id
      join public.club_products product on product.id=ms.product_id and product.organisation_id=ms.organisation_id
      where h.organisation_id=p_organisation_id and h.customer_id=c.id
      order by case ms.status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 when 'suspended' then 2 when 'expired' then 3 when 'cancelled' then 4 else 5 end,
        ms.starts_at desc,ms.created_at desc
      limit 1
    ) history on true
    where c.organisation_id=p_organisation_id and c.user_id is null
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.club_list_unlinked_membership_customers(uuid) from public,anon;
grant execute on function public.club_list_unlinked_membership_customers(uuid) to authenticated;

commit;

begin;

do $$
begin
  if to_regclass('public.club_memberships') is null
    or to_regclass('public.club_membership_holders') is null
    or to_regclass('public.club_customers') is null
    or to_regclass('public.club_members') is null
    or to_regclass('public.club_products') is null
    or to_regclass('public.club_locations') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null then
    raise exception 'Finance member-count prerequisites are missing';
  end if;
  if exists(
    select 1 from (values
      ('club_memberships','id'),('club_memberships','organisation_id'),('club_memberships','product_id'),('club_memberships','status'),('club_memberships','starts_at'),('club_memberships','ends_at'),
      ('club_membership_holders','organisation_id'),('club_membership_holders','membership_id'),('club_membership_holders','user_id'),('club_membership_holders','customer_id'),
      ('club_products','id'),('club_products','organisation_id'),('club_products','kind'),
      ('club_customers','id'),('club_customers','organisation_id'),('club_customers','user_id'),('club_customers','preferred_location_id'),
      ('club_members','organisation_id'),('club_members','user_id'),('club_members','preferred_location_id'),
      ('club_locations','id'),('club_locations','organisation_id'),('club_locations','name'),('club_locations','active')
    ) as req(table_name,column_name)
    where not exists(select 1 from information_schema.columns column_info where column_info.table_schema='public' and column_info.table_name=req.table_name and column_info.column_name=req.column_name)
  ) then
    raise exception 'Finance member-count columns are missing';
  end if;
end;
$$;

create or replace function public.club_finance_member_counts_secure(p_organisation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') then
    raise exception 'Finance access is not permitted' using errcode='42501';
  end if;

  with active_holders as (
    select
      coalesce(h.user_id::text,c.user_id::text,h.customer_id::text) as person_key,
      coalesce(member.preferred_location_id,c.preferred_location_id) as home_location_id
    from public.club_memberships membership
    join public.club_products product on product.id=membership.product_id and product.organisation_id=membership.organisation_id
    join public.club_membership_holders h on h.membership_id=membership.id and h.organisation_id=membership.organisation_id
    left join public.club_customers c on c.id=h.customer_id and c.organisation_id=h.organisation_id
    left join public.club_members member on member.organisation_id=h.organisation_id and member.user_id=coalesce(h.user_id,c.user_id)
    where membership.organisation_id=p_organisation_id
      and membership.status='active'
      and membership.starts_at<=now()
      and (membership.ends_at is null or membership.ends_at>now())
      and product.kind='membership'
      and coalesce(h.user_id::text,c.user_id::text,h.customer_id::text) is not null
  ), people_raw as (
    select person_key,count(distinct home_location_id)::integer as location_count,
      (array_agg(distinct home_location_id))[1] as candidate_location_id
    from active_holders group by person_key
  ), people as (
    select raw.person_key,
      case when raw.location_count=1 and exists(
        select 1 from public.club_locations valid_location
        where valid_location.id=raw.candidate_location_id
          and valid_location.organisation_id=p_organisation_id and valid_location.active
      ) then raw.candidate_location_id else null end as home_location_id,
      case when raw.location_count>1 then 'conflicting'
        when raw.location_count=0 or not exists(
          select 1 from public.club_locations valid_location
          where valid_location.id=raw.candidate_location_id
            and valid_location.organisation_id=p_organisation_id and valid_location.active
        ) then 'unassigned' else 'assigned' end as home_location_state
    from people_raw raw
  ), counts as (
    select location.id,location.name,count(distinct holder.person_key)::integer as member_count
    from public.club_locations location
    left join people holder on holder.home_location_id=location.id
    where location.organisation_id=p_organisation_id and location.active
    group by location.id,location.name
  )
  select jsonb_build_object(
    'as_of',now(),
    'active_members',(select count(*)::integer from people),
    'unassigned_members',(select count(*)::integer from people where home_location_state='unassigned'),
    'conflicting_home_locations',(select count(*)::integer from people where home_location_state='conflicting'),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active_members',member_count) order by name) from counts),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.club_finance_member_counts_secure(uuid) from public,anon,authenticated;
grant execute on function public.club_finance_member_counts_secure(uuid) to authenticated;

commit;

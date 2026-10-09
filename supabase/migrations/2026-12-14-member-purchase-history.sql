-- Member-safe views over staff-only refund evidence.
create or replace function public.club_list_my_order_refunds(p_organisation_id uuid,p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  own_order boolean;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  select exists(
    select 1 from public.club_orders o
    where o.id=p_order_id and o.organisation_id=p_organisation_id
      and (o.user_id=auth.uid() or exists(
        select 1 from public.club_customers c
        where c.id=o.customer_id and c.organisation_id=o.organisation_id and c.user_id=auth.uid()
      ))
  ) into own_order;
  if not own_order then
    raise exception 'Order history is not available' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'amountMinor',r.amount_minor,'createdAt',r.created_at,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object('productName',i.product_name,'quantity',a.quantity,'amountMinor',a.amount_minor)
        order by i.created_at,i.id)
      from public.club_refund_line_allocations a
      join public.club_order_items i on i.id=a.order_item_id and i.organisation_id=a.organisation_id
      where a.refund_id=r.id and a.organisation_id=r.organisation_id
    ),'[]'::jsonb)
  ) order by r.created_at desc),'[]'::jsonb)
  into result
  from public.club_refunds r
  where r.organisation_id=p_organisation_id and r.order_id=p_order_id;
  return result;
end;
$$;
revoke all on function public.club_list_my_order_refunds(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_list_my_order_refunds(uuid,uuid) to authenticated;

create or replace function public.club_list_my_service_credit_balances(p_organisation_id uuid)
returns table(credit_key text,unit text,remaining_quantity bigint,expires_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.club_customers c
    where c.organisation_id=p_organisation_id and c.user_id=auth.uid()
  ) then
    raise exception 'Service balances are not available' using errcode='42501';
  end if;
  return query
  select l.credit_key,l.unit,sum(l.remaining_quantity)::bigint,l.expires_at
  from public.club_service_credit_lots l
  where l.organisation_id=p_organisation_id and l.remaining_quantity>0
    and (l.expires_at is null or l.expires_at>now())
    and (l.user_id=auth.uid() or exists(
      select 1 from public.club_customers c
      where c.id=l.customer_id and c.organisation_id=p_organisation_id and c.user_id=auth.uid()
    ))
  group by l.credit_key,l.unit,l.expires_at
  order by l.credit_key,l.expires_at nulls last;
end;
$$;
revoke all on function public.club_list_my_service_credit_balances(uuid) from public,anon,authenticated;
grant execute on function public.club_list_my_service_credit_balances(uuid) to authenticated;

-- The staff-facing 12-13 access-safety RPC requires members.view. This
-- self-scoped wrapper lets a member see their own 24-hour eligibility only.
create or replace function public.club_get_my_access_eligibility(p_organisation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  member_customer public.club_customers%rowtype;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  select * into member_customer from public.club_customers c
  where c.organisation_id=p_organisation_id and c.user_id=auth.uid();
  if not found then
    raise exception 'Member access information is not available' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationName',l.name,
    'eligible',coalesce((facts->>'twentyFourHourEligible')::boolean,false),
    'membershipEligible',coalesce((facts->>'membershipEligible')::boolean,false),
    'ageState',facts->>'ageState',
    'inductionState',facts->>'inductionState',
    'blocked',coalesce((facts->>'blocked')::boolean,false)
  ) order by l.name),'[]'::jsonb)
  into result
  from public.club_locations l
  cross join lateral (select public.club_access_safety_facts(p_organisation_id,member_customer.id,l.id,now()) facts) x
  where l.organisation_id=p_organisation_id and l.active and l.access_mode='DOOR_CONTROLLED';
  return result;
end;
$$;
revoke all on function public.club_get_my_access_eligibility(uuid) from public,anon,authenticated;
grant execute on function public.club_get_my_access_eligibility(uuid) to authenticated;

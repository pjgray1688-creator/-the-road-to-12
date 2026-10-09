-- Operational access pause/reactivation for memberships. Billing authority is
-- intentionally unchanged; a pause only withdraws membership-backed access.
create table if not exists public.club_membership_access_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  previous_status text not null,
  new_status text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (membership_id, organisation_id)
    references public.club_memberships(id, organisation_id) on delete restrict,
  check (previous_status in ('active','paused')),
  check (new_status in ('active','paused')),
  check (previous_status <> new_status),
  check (char_length(reason) between 3 and 500)
);

create index if not exists club_membership_access_events_history_idx
  on public.club_membership_access_events (organisation_id, membership_id, created_at desc);
alter table public.club_membership_access_events enable row level security;
revoke all on public.club_membership_access_events from public, anon, authenticated;

create or replace function public.club_set_membership_access_status(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership public.club_memberships%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null
     or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'memberships.end_immediately') then
    raise exception 'Membership access change is not permitted' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'paused') or v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Choose pause or reactivate and provide a reason' using errcode = '22023';
  end if;

  select * into v_membership
  from public.club_memberships
  where id = p_membership_id and organisation_id = p_organisation_id
  for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;

  if p_status = 'paused' and v_membership.status <> 'active' then
    raise exception 'Only an active membership can be paused' using errcode = '22023';
  elsif p_status = 'active' and v_membership.status <> 'paused' then
    raise exception 'Only a paused membership can be reactivated' using errcode = '22023';
  elsif p_status = 'active' and v_membership.ends_at is not null and v_membership.ends_at <= now() then
    raise exception 'This membership has expired and cannot be reactivated' using errcode = '22023';
  elsif p_status = 'active' and v_membership.starts_at > now() then
    raise exception 'This membership has not started yet' using errcode = '22023';
  end if;

  insert into public.club_membership_access_events
    (organisation_id, membership_id, actor_user_id, previous_status, new_status, reason)
  values
    (p_organisation_id, v_membership.id, auth.uid(), v_membership.status, p_status, v_reason);

  update public.club_memberships
  set status = p_status
  where id = v_membership.id and organisation_id = p_organisation_id
  returning * into v_membership;
  return to_jsonb(v_membership);
end;
$$;

revoke all on function public.club_set_membership_access_status(uuid, uuid, text, text) from public, anon;
grant execute on function public.club_set_membership_access_status(uuid, uuid, text, text) to authenticated;

create or replace function public.club_list_customer_memberships(p_organisation_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'members.view') then
    raise exception 'Member record is not available' using errcode = '42501';
  end if;
  if not exists(select 1 from public.club_customers c where c.id = p_customer_id and c.organisation_id = p_organisation_id) then
    raise exception 'Member record is not available' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'product_name', p.name, 'status', m.status,
      'starts_at', m.starts_at, 'ends_at', m.ends_at
    ) order by (m.status = 'active') desc, m.starts_at desc)
    from public.club_membership_holders h
    join public.club_memberships m on m.id = h.membership_id and m.organisation_id = h.organisation_id
    join public.club_products p on p.id = m.product_id and p.organisation_id = m.organisation_id
    join public.club_customers c on c.id = p_customer_id and c.organisation_id = p_organisation_id
    where h.organisation_id = p_organisation_id
      and (h.customer_id = c.id or (c.user_id is not null and h.user_id = c.user_id))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.club_list_customer_memberships(uuid, uuid) from public, anon;
grant execute on function public.club_list_customer_memberships(uuid, uuid) to authenticated;

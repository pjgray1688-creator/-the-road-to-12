-- Launch-critical reception safety for member creation, paid activation and
-- staff-visible joining state. Review-only migration: it performs no member,
-- payment, role or ownership backfill.

create or replace function public.club_create_customer(p_organisation_id uuid,p_user_id uuid,p_display_name text,p_email text,p_phone text,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_customers%rowtype; v_staff boolean; v_email text:=nullif(lower(btrim(p_email)),'');
begin
  v_staff:=auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create');
  if auth.uid() is null or (not v_staff and p_user_id is distinct from auth.uid()) then raise exception 'Customer creation is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active) then raise exception 'Organisation is unavailable' using errcode='22023'; end if;
  if nullif(btrim(p_display_name),'') is null or p_status not in ('guest','member','customer') or (not v_staff and p_status<>'customer') then raise exception 'Invalid customer input' using errcode='22023'; end if;
  if v_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organisation_id::text||':'||v_email,0));
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email) then
      raise exception 'A customer with this email already exists' using errcode='23505';
    end if;
  end if;
  insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
  values(p_organisation_id,p_user_id,btrim(p_display_name),v_email,nullif(btrim(p_phone),''),p_status) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.club_create_customer(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.club_create_customer(uuid,uuid,text,text,text,text) to authenticated;

create or replace function public.club_guard_madhouse_paid_staff_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source='staff_assignment' and exists(
    select 1 from public.club_products p
    join public.club_organisations o on o.id=p.organisation_id
    where p.id=new.product_id and p.organisation_id=new.organisation_id
      and o.slug='madhouse-gym' and p.sellable and p.price_minor>0
  ) then
    raise exception 'Paid Madhouse memberships require trusted checkout confirmation' using errcode='22023';
  end if;
  return new;
end;
$$;
drop trigger if exists club_guard_madhouse_paid_staff_assignment on public.club_memberships;
create trigger club_guard_madhouse_paid_staff_assignment
before insert or update of organisation_id,product_id,source on public.club_memberships
for each row execute function public.club_guard_madhouse_paid_staff_assignment();
revoke all on function public.club_guard_madhouse_paid_staff_assignment() from public,anon,authenticated;

create or replace function public.club_get_member_join_state(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then
    raise exception 'Member payment state is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Member not found' using errcode='P0002';
  end if;
  select j.*,p.name product_name,p.currency,l.name location_name into r
  from public.club_membership_join_requests j
  join public.club_products p on p.id=j.product_id and p.organisation_id=j.organisation_id
  left join public.club_locations l on l.id=j.location_id and l.organisation_id=j.organisation_id
  where j.organisation_id=p_organisation_id and j.user_id=p_user_id
  order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id',r.id,'status',r.status,'product_name',r.product_name,'location_name',r.location_name,
    'payment_state',r.payment_state,'checkout_kind',r.checkout_kind,'currency',r.currency,
    'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state,'paid_through_at',r.paid_through_at,
    'membership_id',r.membership_id,'updated_at',r.updated_at
  );
end;
$$;
revoke all on function public.club_get_member_join_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_member_join_state(uuid,uuid) to authenticated;

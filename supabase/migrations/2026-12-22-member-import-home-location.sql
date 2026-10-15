-- Resolve member-import home locations against active locations in the same
-- organisation. Home location is a preference only; membership entitlements
-- remain the sole authority for access to Rotherham, Carlton, or other venues.

alter table public.club_customers
  add column if not exists preferred_location_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.club_customers'::regclass
      and conname='club_customers_preferred_location_org_fk'
  ) then
    alter table public.club_customers
      add constraint club_customers_preferred_location_org_fk
      foreign key (preferred_location_id,organisation_id)
      references public.club_locations(id,organisation_id);
  end if;
end $$;

alter table public.club_member_import_rows
  add column if not exists home_location_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.club_member_import_rows'::regclass
      and conname='club_member_import_rows_home_location_org_fk'
  ) then
    alter table public.club_member_import_rows
      add constraint club_member_import_rows_home_location_org_fk
      foreign key (home_location_id,organisation_id)
      references public.club_locations(id,organisation_id);
  end if;
end $$;

comment on column public.club_customers.preferred_location_id is
  'Optional source-derived home gym preference for imported customers; never grants or restricts venue access.';

create or replace function public.club_member_import_resolve_home_location()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare source_name text; import_mapping jsonb; match_count integer; resolved_id uuid;
begin
  -- The currently deployed revalidation RPC rebuilds normalized_values and does
  -- not retain homeLocation. Read the explicitly mapped source column here,
  -- alongside the supported common header aliases.
  select mapping into import_mapping
    from public.club_member_import_batches
    where id=new.batch_id and organisation_id=new.organisation_id;
  source_name:=nullif(btrim(coalesce(
    new.normalized_values->>'homeLocation',
    new.raw_values->>(import_mapping->>'homeLocation'),
    new.raw_values->>'home_gym',
    new.raw_values->>'home_location',
    new.raw_values->>'home location'
  ,'')),'');
  new.home_location_id:=null;
  if source_name is null then
    new.normalized_values:=coalesce(new.normalized_values,'{}'::jsonb)
      || jsonb_build_object('homeLocationStatus','not_provided');
    return new;
  end if;

  select count(*),(array_agg(l.id order by l.id))[1]
    into match_count,resolved_id
  from public.club_locations l
  where l.organisation_id=new.organisation_id and l.active
    and (
      lower(btrim(l.name))=lower(source_name)
      or (lower(source_name) in ('rotherham','carlton')
          and lower(source_name)=any(regexp_split_to_array(lower(l.name),'[^[:alnum:]]+')))
    );

  if match_count=1 then
    new.home_location_id:=resolved_id;
    new.normalized_values:=coalesce(new.normalized_values,'{}'::jsonb)
      || jsonb_build_object('homeLocationId',resolved_id,'homeLocationStatus','matched');
  elsif match_count=0 then
    new.normalized_values:=coalesce(new.normalized_values,'{}'::jsonb)
      || jsonb_build_object('homeLocationStatus','unknown');
    if not (coalesce(new.blockers,'[]'::jsonb) @> jsonb_build_array('Home location does not match an active location in this organisation')) then
      new.blockers:=coalesce(new.blockers,'[]'::jsonb)
        || jsonb_build_array('Home location does not match an active location in this organisation');
    end if;
  else
    new.normalized_values:=coalesce(new.normalized_values,'{}'::jsonb)
      || jsonb_build_object('homeLocationStatus','ambiguous');
    if not (coalesce(new.blockers,'[]'::jsonb) @> jsonb_build_array('Home location matches more than one active location in this organisation')) then
      new.blockers:=coalesce(new.blockers,'[]'::jsonb)
        || jsonb_build_array('Home location matches more than one active location in this organisation');
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.club_member_import_resolve_home_location() from public,anon,authenticated;

drop trigger if exists club_member_import_resolve_home_location on public.club_member_import_rows;
create trigger club_member_import_resolve_home_location
before update of normalized_values on public.club_member_import_rows
for each row execute function public.club_member_import_resolve_home_location();

create or replace function public.club_member_import_apply_home_location()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare customer_user_id uuid;
begin
  if new.outcome not in ('imported','linked') or new.imported_customer_id is null or new.home_location_id is null then
    return new;
  end if;
  update public.club_customers
    set preferred_location_id=new.home_location_id,updated_at=now()
    where id=new.imported_customer_id and organisation_id=new.organisation_id
    returning user_id into customer_user_id;
  if not found then raise exception 'Imported customer is unavailable for home-location assignment' using errcode='23503'; end if;
  if customer_user_id is not null then
    update public.club_members
      set preferred_location_id=new.home_location_id
      where organisation_id=new.organisation_id and user_id=customer_user_id;
  end if;
  return new;
end; $$;
revoke all on function public.club_member_import_apply_home_location() from public,anon,authenticated;

drop trigger if exists club_member_import_apply_home_location on public.club_member_import_rows;
create trigger club_member_import_apply_home_location
after update of outcome on public.club_member_import_rows
for each row
when (new.outcome in ('imported','linked') and new.home_location_id is not null)
execute function public.club_member_import_apply_home_location();

create or replace function public.club_customer_copy_home_location_to_member()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.user_id is not null and new.user_id is distinct from old.user_id
     and new.preferred_location_id is not null then
    update public.club_members
      set preferred_location_id=new.preferred_location_id
      where organisation_id=new.organisation_id and user_id=new.user_id;
  end if;
  return new;
end; $$;
revoke all on function public.club_customer_copy_home_location_to_member() from public,anon,authenticated;

drop trigger if exists club_customer_copy_home_location_to_member on public.club_customers;
create trigger club_customer_copy_home_location_to_member
after update of user_id on public.club_customers
for each row execute function public.club_customer_copy_home_location_to_member();

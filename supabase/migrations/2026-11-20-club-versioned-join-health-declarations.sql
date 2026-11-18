-- Versioned health-declaration contract. No declaration text or required version
-- is inserted by this migration; production remains non-blocking until approved
-- Madhouse wording and operational policy are supplied and explicitly published.
begin;

create table if not exists public.club_join_health_declaration_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  version text not null,
  title text not null,
  body text not null,
  status text not null default 'draft' check(status in ('draft','published','retired')),
  required_for_joining boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,version),
  unique(id,organisation_id),
  check(status<>'published' or (approved_at is not null and published_at is not null and length(btrim(title))>0 and length(btrim(body))>0))
);

create table if not exists public.club_join_health_declaration_acceptances (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  declaration_version_id uuid not null,
  accepted_at timestamptz not null default now(),
  unique(organisation_id,user_id,declaration_version_id),
  foreign key(declaration_version_id,organisation_id)
    references public.club_join_health_declaration_versions(id,organisation_id) on delete restrict
);

alter table public.club_join_health_declaration_versions enable row level security;
alter table public.club_join_health_declaration_acceptances enable row level security;
revoke all on public.club_join_health_declaration_versions,public.club_join_health_declaration_acceptances from public,anon,authenticated;
grant select,insert,update on public.club_join_health_declaration_versions to service_role;
grant select,insert on public.club_join_health_declaration_acceptances to service_role;

create or replace function public.club_get_current_join_health_declaration(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',v.id,'version',v.version,'title',v.title,'body',v.body,
    'required_for_joining',v.required_for_joining)
  from public.club_join_health_declaration_versions v
  join public.club_organisations o on o.id=v.organisation_id and o.active
  where auth.uid() is not null and v.organisation_id=p_organisation_id
    and v.status='published' and v.approved_at is not null
  order by v.published_at desc,v.created_at desc limit 1;
$$;
revoke all on function public.club_get_current_join_health_declaration(uuid) from public,anon;
grant execute on function public.club_get_current_join_health_declaration(uuid) to authenticated;

create or replace function public.club_accept_join_health_declaration(p_organisation_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version public.club_join_health_declaration_versions%rowtype; v_acceptance public.club_join_health_declaration_acceptances%rowtype;
  v_role text; v_inserted boolean:=false;
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  select * into v_version from public.club_join_health_declaration_versions
    where id=p_version_id and organisation_id=p_organisation_id and status='published' and approved_at is not null;
  if not found then raise exception 'Health declaration version is unavailable' using errcode='22023'; end if;
  insert into public.club_join_health_declaration_acceptances(organisation_id,user_id,declaration_version_id)
    values(p_organisation_id,auth.uid(),v_version.id)
    on conflict(organisation_id,user_id,declaration_version_id) do nothing
    returning * into v_acceptance;
  if found then
    v_inserted:=true;
  else
    select * into v_acceptance from public.club_join_health_declaration_acceptances
      where organisation_id=p_organisation_id and user_id=auth.uid() and declaration_version_id=v_version.id;
  end if;
  if v_inserted then
    select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,auth.uid(),v_role,'membership.health_declaration_accepted','health_declaration_version',v_version.id,
        jsonb_build_object('version',v_version.version,'accepted_at',v_acceptance.accepted_at));
  end if;
  return jsonb_build_object('accepted',true,'version_id',v_version.id,'accepted_at',v_acceptance.accepted_at);
end; $$;
revoke all on function public.club_accept_join_health_declaration(uuid,uuid) from public,anon;
grant execute on function public.club_accept_join_health_declaration(uuid,uuid) to authenticated;

create or replace function public.club_require_join_health_declaration()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version uuid;
begin
  if new.user_id is null or new.status in ('cancelled','rejected') then return new; end if;
  select id into v_version from public.club_join_health_declaration_versions
    where organisation_id=new.organisation_id and status='published' and approved_at is not null
      and required_for_joining
    order by published_at desc,created_at desc limit 1;
  if v_version is null then return new; end if;
  if not exists(select 1 from public.club_join_health_declaration_acceptances a
    where a.organisation_id=new.organisation_id and a.user_id=new.user_id
      and a.declaration_version_id=v_version) then
    raise exception 'Required health declaration has not been accepted' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.club_require_join_health_declaration() from public,anon,authenticated;
drop trigger if exists club_require_join_health_declaration on public.club_membership_join_requests;
create trigger club_require_join_health_declaration
before insert or update of organisation_id,user_id,status,membership_id
on public.club_membership_join_requests
for each row execute function public.club_require_join_health_declaration();

commit;

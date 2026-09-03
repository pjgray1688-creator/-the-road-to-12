-- Staff capability overrides and append-only operational audit trail.
create table if not exists public.club_staff_permission_overrides (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, capability text not null,
  decision text not null check (decision in ('allow','deny')), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique (organisation_id,user_id,capability)
);
create table if not exists public.club_audit_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id), actor_role text, action text not null, target_type text, target_id uuid, location_id uuid references public.club_locations(id), reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists club_audit_events_org_created_idx on public.club_audit_events(organisation_id,created_at desc);
alter table public.club_staff_permission_overrides enable row level security;
alter table public.club_audit_events enable row level security;

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny') then false
    when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow') then true
    else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active and (m.role='owner' or (m.role='gym_admin' and p_capability not like 'staff.permissions_manage') or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','classes.view','services.view','induction.view'))) ) end;
$$;
create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_staff_permission_overrides%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Staff permissions require owner access' using errcode='42501'; end if;
 if p_decision not in ('allow','deny') then raise exception 'Invalid permission decision' using errcode='22023'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then raise exception 'Staff member not found' using errcode='P0002'; end if;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid()) on conflict (organisation_id,user_id,capability) do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now() returning * into r;
 return to_jsonb(r);
end; $$;
create or replace function public.club_append_audit_event(p_organisation_id uuid,p_action text,p_target_type text,p_target_id uuid,p_location_id uuid,p_reason text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_audit_events%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Audit access denied' using errcode='42501'; end if; insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata) select p_organisation_id,auth.uid(),m.role,p_action,p_target_type,p_target_id,p_location_id,p_reason,coalesce(p_metadata,'{}') from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active returning * into r; return to_jsonb(r); end; $$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
revoke all on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;
grant execute on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) to authenticated;

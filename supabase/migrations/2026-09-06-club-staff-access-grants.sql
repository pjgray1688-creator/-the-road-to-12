-- Pending Club staff access prepared by an owner/admin. No email is sent here.
create table if not exists public.club_staff_access_grants (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  email_normalized text not null, display_name text, intended_role text not null check (intended_role in ('gym_staff','gym_admin','trainer')),
  location_ids uuid[] not null default '{}', capabilities text[] not null default '{}', status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_by uuid references auth.users(id), accepted_at timestamptz, revoked_at timestamptz
);
create unique index if not exists club_staff_access_grants_pending_key on public.club_staff_access_grants(organisation_id,email_normalized) where status='pending';
create unique index if not exists club_locations_org_id_key on public.club_locations(organisation_id,id);
create table if not exists public.club_staff_location_access (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.club_locations(id) on delete cascade, created_at timestamptz not null default now(),
  primary key (organisation_id,user_id,location_id), foreign key (organisation_id,location_id) references public.club_locations(organisation_id, id)
);
alter table public.club_staff_access_grants enable row level security; alter table public.club_staff_location_access enable row level security;
revoke all on table public.club_staff_access_grants, public.club_staff_location_access from public, anon, authenticated;
grant select on public.club_staff_access_grants to authenticated;
create policy club_staff_grants_admin_read on public.club_staff_access_grants for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_admin','owner']) or (email_normalized = lower(btrim(coalesce(auth.jwt()->>'email',''))) and status='pending' and expires_at>now()));
create policy club_staff_locations_self_read on public.club_staff_location_access for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_admin','owner']));
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select auth.uid() is not null and p_user_id=auth.uid() and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') and not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny') and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active and (m.role in ('owner','gym_admin') or (m.role in ('gym_staff','trainer') and p_capability in ('members.view','members.create','members.link_account','memberships.assign','payments.take','payments.record_cash','induction.perform','classes.manage','services.manage','supplier.receive','commerce.collections_manage')) or exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow')));
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon; grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;
create or replace function public.club_location_authorized(p_organisation_id uuid,p_location_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin')) or exists(select 1 from public.club_staff_location_access a where a.organisation_id=p_organisation_id and a.location_id=p_location_id and a.user_id=auth.uid()); $$;
revoke all on function public.club_location_authorized(uuid,uuid) from public,anon; grant execute on function public.club_location_authorized(uuid,uuid) to authenticated;
create or replace function public.club_create_staff_access_grant(p_organisation_id uuid,p_email text,p_display_name text,p_role text,p_location_ids uuid[],p_capabilities text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; e text; begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if;
 if p_role not in ('gym_staff','gym_admin','trainer') or nullif(btrim(p_email),'') is null then raise exception 'Invalid staff access request' using errcode='22023'; end if;
 if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
 foreach e in array coalesce(p_capabilities,'{}') loop if e not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Invalid capability' using errcode='22023'; end if; end loop;
 update public.club_staff_access_grants set status='expired' where organisation_id=p_organisation_id and email_normalized=lower(btrim(p_email)) and status='pending' and expires_at<=now();
 insert into public.club_staff_access_grants(organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,created_by) values(p_organisation_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,coalesce(p_location_ids,'{}'),coalesce(p_capabilities,'{}'),auth.uid()) returning * into g;
 return to_jsonb(g);
end; $$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) from public,anon; grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) to authenticated;
create or replace function public.club_claim_staff_access_grant(p_grant_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; email text; begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; select lower(email) into email from auth.users where id=auth.uid(); select * into g from public.club_staff_access_grants where id=p_grant_id and status='pending' and expires_at>now() and email_normalized=lower(btrim(email)) for update; if not found then raise exception 'Staff access grant is unavailable' using errcode='42501'; end if;
 insert into public.club_members(organisation_id,user_id,role,active) values(g.organisation_id,auth.uid(),g.intended_role,true) on conflict (organisation_id,user_id) do update set role=excluded.role,active=true;
 insert into public.club_staff_location_access(organisation_id,user_id,location_id) select g.organisation_id,auth.uid(),x from unnest(g.location_ids) x on conflict do nothing;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) select g.organisation_id,auth.uid(),x,'allow',g.created_by from unnest(g.capabilities) x on conflict (organisation_id,user_id,capability) do update set decision='allow',created_by=excluded.created_by,created_at=now();
 update public.club_staff_access_grants set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=g.id; return jsonb_build_object('id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,'status','accepted');
end; $$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon; grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;
create or replace function public.club_revoke_staff_access_grant(p_organisation_id uuid,p_grant_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare g public.club_staff_access_grants%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if; update public.club_staff_access_grants set status='revoked',revoked_at=now() where id=p_grant_id and organisation_id=p_organisation_id and status='pending' returning * into g; if not found then raise exception 'Pending grant not found' using errcode='P0002'; end if; return to_jsonb(g); end; $$;
revoke all on function public.club_revoke_staff_access_grant(uuid,uuid) from public,anon; grant execute on function public.club_revoke_staff_access_grant(uuid,uuid) to authenticated;

create or replace function public.club_replace_staff_locations(p_organisation_id uuid,p_user_id uuid,p_location_ids uuid[])
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if;
 if exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='owner') and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and role='owner') then raise exception 'Only an owner may edit an owner' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.id=x and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and role in ('gym_staff','gym_admin','trainer') ) then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
 delete from public.club_staff_location_access where organisation_id=p_organisation_id and user_id=p_user_id;
 insert into public.club_staff_location_access(organisation_id,user_id,location_id) select p_organisation_id,p_user_id,x from unnest(coalesce(p_location_ids,'{}')) x;
end; $$;
revoke all on function public.club_replace_staff_locations(uuid,uuid,uuid[]) from public,anon; grant execute on function public.club_replace_staff_locations(uuid,uuid,uuid[]) to authenticated;

create or replace function public.club_set_staff_active(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text; owners integer;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if;
 select role into target_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id;
 if target_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
 if target_role='owner' and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and role='owner') then raise exception 'Only an owner may edit an owner' using errcode='42501'; end if;
 if target_role='owner' and not p_active then select count(*) into owners from public.club_members where organisation_id=p_organisation_id and role='owner' and active; if owners<=1 then raise exception 'The organisation must retain an active owner' using errcode='42501'; end if; end if;
 update public.club_members set active=p_active where organisation_id=p_organisation_id and user_id=p_user_id;
end; $$;
revoke all on function public.club_set_staff_active(uuid,uuid,boolean) from public,anon; grant execute on function public.club_set_staff_active(uuid,uuid,boolean) to authenticated;

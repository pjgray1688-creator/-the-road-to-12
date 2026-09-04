-- Add supplier/collection capabilities to the canonical Club permission model.
-- This preserves deny/allow precedence, owner protection, and existing presets.
alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'));

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    when p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then false
    when exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role='owner' and p_capability='staff.permissions_manage') then true
    when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='deny') then false
    when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='allow') then true
    else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and (
      (m.role='owner' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'))
      or (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'))
      or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage'))
      or (m.role='trainer' and p_capability='members.view')))
  end;
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;

create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_staff_permission_overrides%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Staff permissions require owner access' using errcode='42501'; end if;
 if p_decision not in ('allow','deny') then raise exception 'Invalid permission decision' using errcode='22023'; end if;
 if p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Unknown capability' using errcode='22023'; end if;
 if p_capability='staff.permissions_manage' and p_decision='allow' and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='owner') then raise exception 'Owner capability cannot be granted to non-owner' using errcode='42501'; end if;
 if p_capability='staff.permissions_manage' and p_decision='deny' and p_user_id=auth.uid() then raise exception 'Owner administration cannot be denied to the acting owner' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role in ('gym_staff','gym_admin','owner')) then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid()) on conflict (organisation_id,user_id,capability) do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now() returning * into r;
 insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) select p_organisation_id,auth.uid(),m.role,'staff.permission_changed','staff',p_user_id,jsonb_build_object('capability',p_capability,'decision',p_decision) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;

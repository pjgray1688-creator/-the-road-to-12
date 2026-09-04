-- Extend the canonical Club capability evaluator without moving ownership into
-- the supplier domain migration.
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select case
  when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='deny') then false
  when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='allow') then true
  else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and ((m.role='owner') or (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage')) or (m.role='trainer' and p_capability='members.view')))
end;
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;

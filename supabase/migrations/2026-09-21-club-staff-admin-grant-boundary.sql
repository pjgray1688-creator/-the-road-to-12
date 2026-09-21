-- Only owners may prepare a pending grant that will create another gym_admin.
-- Existing gym_admin authority to grant gym_staff and trainer access is unchanged.
create or replace function public.club_create_staff_access_grant(p_organisation_id uuid,p_email text,p_display_name text,p_role text,p_location_ids uuid[],p_capabilities text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; e text;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if;
 if p_role not in ('gym_staff','gym_admin','trainer') or nullif(btrim(p_email),'') is null then raise exception 'Invalid staff access request' using errcode='22023'; end if;
 if p_role='gym_admin' and not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Only an owner may grant admin access' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
 foreach e in array coalesce(p_capabilities,'{}') loop if e not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Invalid capability' using errcode='22023'; end if; end loop;
 update public.club_staff_access_grants set status='expired' where organisation_id=p_organisation_id and email_normalized=lower(btrim(p_email)) and status='pending' and expires_at<=now();
 insert into public.club_staff_access_grants(organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,created_by) values(p_organisation_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,coalesce(p_location_ids,'{}'),coalesce(p_capabilities,'{}'),auth.uid()) returning * into g;
 return to_jsonb(g);
end; $$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) from public,anon; grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) to authenticated;

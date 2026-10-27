-- Verified Glow Zone users may safely attach one exact email match or create a
-- standalone customer profile. This never creates a gym membership, entitlement,
-- payment agreement, access grant, balance, or service credit.
create or replace function public.club_glow_ensure_customer(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_verified_at timestamptz;
  v_name text;
  v_count integer;
  v_customer public.club_customers%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists (
    select 1 from public.club_organisations o
    where o.id=p_organisation_id and o.active
      and exists (select 1 from public.club_location_service_hours h where h.organisation_id=o.id and h.service_key='sunbeds')
  ) then raise exception 'Glow Zone is unavailable' using errcode='22023'; end if;
  select lower(btrim(u.email)),u.email_confirmed_at,
    coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(btrim(p.display_name),''),split_part(u.email,'@',1),'Glow Zone customer')
  into v_email,v_verified_at,v_name
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_user_id;
  if v_email is null or v_verified_at is null then raise exception 'Verified email required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||v_user_id::text,0));
  select * into v_customer from public.club_customers
    where organisation_id=p_organisation_id and user_id=v_user_id for update;
  if found then return jsonb_build_object('customer_id',v_customer.id,'status','already_linked'); end if;
  select count(*) into v_count from public.club_customers
    where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count>1 then raise exception 'Customer records require staff review' using errcode='23505'; end if;
  if v_count=1 then
    select * into v_customer from public.club_customers
      where organisation_id=p_organisation_id and lower(btrim(email))=v_email for update;
    if v_customer.user_id is not null and v_customer.user_id<>v_user_id then raise exception 'Customer record is already linked' using errcode='23505'; end if;
    update public.club_customers set user_id=v_user_id,updated_at=now() where id=v_customer.id returning * into v_customer;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,v_user_id,'customer','glow.customer_self_linked','customer',v_customer.id,jsonb_build_object('match','verified_email'));
    return jsonb_build_object('customer_id',v_customer.id,'status','linked_existing');
  end if;
  insert into public.club_customers(organisation_id,user_id,display_name,email,status)
    values(p_organisation_id,v_user_id,v_name,v_email,'customer') returning * into v_customer;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,v_user_id,'customer','glow.customer_created','customer',v_customer.id,jsonb_build_object('source','verified_account'));
  return jsonb_build_object('customer_id',v_customer.id,'status','created');
end; $$;
revoke all on function public.club_glow_ensure_customer(uuid) from public,anon,authenticated;
grant execute on function public.club_glow_ensure_customer(uuid) to authenticated;

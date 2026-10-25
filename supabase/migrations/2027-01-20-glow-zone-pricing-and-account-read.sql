-- Keep reception fulfilment aligned with the public Glow Zone catalogue and allow
-- customers to read only their own age-verification row through the existing RLS policy.
grant select on table public.club_glow_age_verifications to authenticated;

create or replace function public.club_glow_complete_sale(
  p_organisation_id uuid,
  p_location_id uuid,
  p_user_id uuid,
  p_package_id text,
  p_minutes integer,
  p_tender_type text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  s public.club_glow_sales%rowtype;
  price integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Sale not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then
    raise exception 'Glow Zone is only available at Carlton' using errcode='22023';
  end if;
  select * into s from public.club_glow_sales where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(s); end if;

  if p_package_id in ('member-30','member-60','member-100') then
    if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then
      raise exception 'Member package requires active membership' using errcode='42501';
    end if;
    price := case p_package_id when 'member-30' then 1000 when 'member-60' then 1800 else 3000 end;
  elsif p_package_id in ('standard-30','standard-60','standard-100') then
    price := case p_package_id when 'standard-30' then 1500 when 'standard-60' then 2500 else 4000 end;
  elsif p_package_id='payg' then
    price := p_minutes*100;
  else
    raise exception 'Unknown Glow Zone package' using errcode='22023';
  end if;

  if p_minutes<=0 or (p_package_id<>'payg' and p_minutes <> case
    when p_package_id like '%-30' then 30 when p_package_id like '%-60' then 60 else 100 end) then
    raise exception 'Invalid Glow Zone quantity' using errcode='22023';
  end if;
  insert into public.club_glow_sales(organisation_id,location_id,user_id,package_id,minutes,amount_minor,tender_type,actor_user_id,idempotency_key)
  values(p_organisation_id,p_location_id,p_user_id,p_package_id,p_minutes,price,p_tender_type,auth.uid(),p_idempotency_key) returning * into s;
  insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
  values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','purchased',s.id::text,p_location_id,auth.uid(),'sale:'||s.id::text);
  return to_jsonb(s);
end;
$$;

revoke all on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) to authenticated;

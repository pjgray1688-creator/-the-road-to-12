-- Contact editing for linked Club members. This migration is additive and is not applied automatically.
alter table public.club_customers
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists town_city text,
  add column if not exists postcode text;

-- Keep class instructor labels aligned with the current linked R12 profile name,
-- rather than the older display-name or session snapshot when first/last names exist.
create or replace function public.club_list_member_identities(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity directory is not permitted' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,
    'display_name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(btrim(p.display_name),''),nullif(btrim(p.email),'')),
    'email',nullif(btrim(p.email),'')) order by m.created_at)
    from public.club_members m left join public.profiles p on p.id=m.user_id
    where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_member_identities(uuid) from public,anon;
grant execute on function public.club_list_member_identities(uuid) to authenticated;

create or replace function public.club_get_member_contact(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member contact access is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Member is not active in this organisation' using errcode='P0002';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then raise exception 'Linked member customer record was not found' using errcode='P0002'; end if;
  return jsonb_build_object('phone',c.phone,'address_line_1',c.address_line_1,'address_line_2',c.address_line_2,'town_city',c.town_city,'postcode',c.postcode);
end; $$;

create or replace function public.club_update_member_contact(
  p_organisation_id uuid,p_user_id uuid,p_phone text,p_address_line_1 text,
  p_address_line_2 text,p_town_city text,p_postcode text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; actor_role text; changed_fields text[]:=array[]::text[];
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member contact editing is not permitted' using errcode='42501';
  end if;
  if length(coalesce(p_phone,''))>40 or length(coalesce(p_address_line_1,''))>160 or length(coalesce(p_address_line_2,''))>160 or length(coalesce(p_town_city,''))>100 or length(coalesce(p_postcode,''))>20 then
    raise exception 'Contact details exceed the allowed length' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Member is not active in this organisation' using errcode='P0002';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found then raise exception 'Linked member customer record was not found' using errcode='P0002'; end if;
  if c.phone is distinct from nullif(btrim(p_phone),'') then changed_fields:=array_append(changed_fields,'phone'); end if;
  if c.address_line_1 is distinct from nullif(btrim(p_address_line_1),'') then changed_fields:=array_append(changed_fields,'address_line_1'); end if;
  if c.address_line_2 is distinct from nullif(btrim(p_address_line_2),'') then changed_fields:=array_append(changed_fields,'address_line_2'); end if;
  if c.town_city is distinct from nullif(btrim(p_town_city),'') then changed_fields:=array_append(changed_fields,'town_city'); end if;
  if c.postcode is distinct from nullif(upper(btrim(p_postcode)),'') then changed_fields:=array_append(changed_fields,'postcode'); end if;
  update public.club_customers set phone=nullif(btrim(p_phone),''),address_line_1=nullif(btrim(p_address_line_1),''),
    address_line_2=nullif(btrim(p_address_line_2),''),town_city=nullif(btrim(p_town_city),''),postcode=nullif(upper(btrim(p_postcode)),''),updated_at=now()
    where id=c.id and organisation_id=p_organisation_id and user_id=p_user_id returning * into c;
  if cardinality(changed_fields)>0 then
    select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,auth.uid(),actor_role,'member.contact_updated','customer',c.id,jsonb_build_object('changed_fields',to_jsonb(changed_fields)));
  end if;
  return jsonb_build_object('phone',c.phone,'address_line_1',c.address_line_1,'address_line_2',c.address_line_2,'town_city',c.town_city,'postcode',c.postcode);
end; $$;

revoke all on function public.club_get_member_contact(uuid,uuid),public.club_update_member_contact(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.club_get_member_contact(uuid,uuid),public.club_update_member_contact(uuid,uuid,text,text,text,text,text) to authenticated;

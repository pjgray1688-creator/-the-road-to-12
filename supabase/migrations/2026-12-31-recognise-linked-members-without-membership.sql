-- Keep a staff-verified account link visible in Member Area even when no
-- membership has been assigned. This does not grant membership or access.
create or replace function public.club_preview_existing_member_claim(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('state','email_verification_required');
  end if;

  -- An established link belongs to the authenticated user ID and remains
  -- valid if the account's contact email later changes.
  select * into c from public.club_customers
  where organisation_id=p_organisation_id and user_id=auth.uid();
  if found then
    return jsonb_build_object(
      'state','already_linked','customer_id',c.id,
      'display_name',c.display_name,'email',c.email,
      'memberships',coalesce((
        select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status))
        from public.club_membership_holders h
        join public.club_memberships m on m.id=h.membership_id
        join public.club_products p on p.id=m.product_id
        where h.organisation_id=p_organisation_id
          and (h.customer_id=c.id or h.user_id=auth.uid())
      ),'[]'::jsonb)
    );
  end if;

  select lower(btrim(email)),email_confirmed_at into v_email,v_verified
  from auth.users where id=auth.uid();
  if v_verified is null then
    return jsonb_build_object('state','email_verification_required');
  end if;

  select count(*) into v_count from public.club_customers
  where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count=0 then return jsonb_build_object('state','staff_help_required'); end if;
  if v_count>1 then return jsonb_build_object('state','ambiguous','message','More than one member record uses this email'); end if;
  select * into c from public.club_customers
  where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if c.user_id is not null then return jsonb_build_object('state','staff_help_required'); end if;
  return jsonb_build_object('state','ready','customer_id',c.id,'display_name',c.display_name,'email',c.email,
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status)) from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_products p on p.id=m.product_id where h.customer_id=c.id),'[]'::jsonb));
end; $$;
revoke all on function public.club_preview_existing_member_claim(uuid) from public,anon;
grant execute on function public.club_preview_existing_member_claim(uuid) to authenticated;

-- Existing members continue to be discovered through their membership
-- holder rows. Also include a linked customer with no membership rows so
-- the app can show the organisation and an explicit no-membership state.
create or replace function public.club_list_my_memberships()
returns setof jsonb
language sql stable security definer set search_path=pg_catalog,public
as $$
  select jsonb_build_object(
    'organisation', jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'active',o.active,'branding',o.branding),
    'membership', jsonb_build_object('id',m.id,'product_name',p.name,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at)
  )
  from public.club_membership_holders h
  join public.club_memberships m on m.id=h.membership_id
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  join public.club_organisations o on o.id=m.organisation_id
  where auth.uid() is not null and h.user_id=auth.uid() and o.active

  union all

  select jsonb_build_object(
    'organisation',jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'active',o.active,'branding',o.branding),
    'membership',null
  )
  from public.club_customers c
  join public.club_organisations o on o.id=c.organisation_id and o.active
  where auth.uid() is not null and c.user_id=auth.uid()
    and not exists (
      select 1 from public.club_membership_holders h
      where h.organisation_id=c.organisation_id and h.user_id=auth.uid()
    );
$$;
revoke all on function public.club_list_my_memberships() from public,anon;
grant execute on function public.club_list_my_memberships() to authenticated;

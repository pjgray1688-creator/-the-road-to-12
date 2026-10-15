-- Email-scoped read model for the signed-in recipient of a staff invitation.
-- The grant selects the requested invitation but never authorises acceptance;
-- club_claim_staff_access_grant remains the authoritative verified-email check.
create or replace function public.club_get_my_staff_claim_context(p_grant_id uuid)
returns table(
  grant_id uuid,
  organisation_id uuid,
  organisation_name text,
  display_name text,
  intended_role text,
  venue_names text[],
  coach_requested boolean,
  grant_status text,
  expires_at timestamptz
) language sql stable security definer set search_path=pg_catalog,public as $$
  select grant_row.id,
    grant_row.organisation_id,
    organisation.name,
    grant_row.display_name,
    grant_row.intended_role,
    coalesce(venues.names,'{}'::text[]),
    grant_row.coach_requested,
    grant_row.status,
    grant_row.expires_at
  from public.club_staff_access_grants grant_row
  join public.club_organisations organisation
    on organisation.id=grant_row.organisation_id and organisation.active
  left join lateral (
    select array_agg(location.name order by location.name) as names
    from public.club_locations location
    where location.organisation_id=grant_row.organisation_id
      and location.id=any(coalesce(grant_row.location_ids,'{}'::uuid[]))
  ) venues on true
  where auth.uid() is not null
    and grant_row.id=p_grant_id
    and (
      (grant_row.status='pending'
        and grant_row.expires_at>now()
        and grant_row.email_normalized=lower(btrim(coalesce(auth.jwt()->>'email',''))))
      or (grant_row.status='accepted' and grant_row.accepted_by=auth.uid())
    );
$$;
revoke all on function public.club_get_my_staff_claim_context(uuid) from public,anon;
grant execute on function public.club_get_my_staff_claim_context(uuid) to authenticated;

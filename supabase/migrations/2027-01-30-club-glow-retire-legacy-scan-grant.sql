-- The SECURITY CONTRACT was corrected in Production to leave the legacy
-- DOB-bearing scanner RPC unavailable to client roles. Keep source history
-- aligned without changing the secure replacement RPC or its caller grant.
begin;

do $$
begin
  if to_regprocedure('public.club_glow_scan_session_request_secure(uuid,text)') is null then
    raise exception 'Secure Glow scanner RPC is required before retiring legacy access';
  end if;

  if to_regprocedure('public.club_glow_scan_session_request(uuid,text)') is not null then
    execute 'revoke all on function public.club_glow_scan_session_request(uuid,text) from public, anon, authenticated';
  end if;
end;
$$;

commit;

-- Read-only Production diagnostic. Replace the UUID placeholder with the
-- immutable Auth UUID of an active Madhouse owner/gym_admin. Run after the
-- performance migration, in a quiet period. ANALYZE executes the STABLE
-- preview function but does not send or queue invitations. EXPLAIN reports
-- the plan/runtime only; it does not print the returned JSON or email values.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','<authorised-manager-auth-uuid>',true);
select set_config('request.jwt.claim.role','authenticated',true);
explain (analyze, buffers, verbose)
select public.club_preview_madhouse_member_activation_invitations(
  'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
);
rollback;

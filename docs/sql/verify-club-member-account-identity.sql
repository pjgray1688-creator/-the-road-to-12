-- Read-only verification for the linked R12 account identity boundary.
select to_regclass('public.profiles') as profiles_table,
       to_regprocedure('public.club_resolve_member_identity(uuid,uuid)') as resolve_member_identity_rpc,
       to_regprocedure('public.club_list_member_identities(uuid)') as list_member_identities_rpc,
       has_function_privilege('authenticated', 'public.club_resolve_member_identity(uuid,uuid)', 'EXECUTE') as authenticated_can_resolve,
       has_function_privilege('authenticated', 'public.club_list_member_identities(uuid)', 'EXECUTE') as authenticated_can_list;

select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid = 'public.profiles'::regclass;

-- Confirm the RPCs are security-definer and do not expose auth.users directly.
select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) like '%auth.users%' as references_auth_users
from pg_proc p
where p.oid in ('public.club_resolve_member_identity(uuid,uuid)'::regprocedure,
                'public.club_list_member_identities(uuid)'::regprocedure);

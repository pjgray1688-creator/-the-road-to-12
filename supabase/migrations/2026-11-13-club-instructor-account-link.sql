begin;

do $$
begin
  if to_regclass('public.club_madhouse_staff_assignments') is null
     or to_regclass('public.club_members') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.club_organisations') is null then
    raise exception 'Prepared instructor account-link prerequisites are missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='canonical_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='normalized_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='staff_grant_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='active')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='active')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='first_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_name') then
    raise exception 'Prepared instructor account-link columns are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='club_madhouse_staff_assignments'
      and column_name='linked_user_id' and udt_name <> 'uuid'
  ) then
    raise exception 'Existing linked_user_id has an incompatible type';
  end if;
end;
$$;

alter table public.club_madhouse_staff_assignments
  add column if not exists linked_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.club_madhouse_staff_assignments'::regclass
      and c.conname='club_madhouse_staff_assignment_linked_user_fk'
      and c.contype='f'
      and c.confrelid='auth.users'::regclass
  ) then
    alter table public.club_madhouse_staff_assignments
      add constraint club_madhouse_staff_assignment_linked_user_fk
      foreign key(linked_user_id) references auth.users(id) on delete set null;
  end if;
end;
$$;

-- Link only the user ID verified from Production diagnostics. Recheck that
-- this exact account is still the sole active Madhouse owner with that full
-- profile name before linking. No invitation, role, capability, location or
-- grant is created or changed.
do $$
declare
  v_organisation_id uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  v_assignment_id uuid := 'ddd31b34-8adb-45c9-8bdd-aaf0db046f60';
  v_user_id uuid := '97e7b69f-ce77-4256-8f4c-5ed77b4a7e84';
  v_matched_user_id uuid;
  v_account_count integer;
  v_assignment public.club_madhouse_staff_assignments%rowtype;
  v_updated integer;
begin
  select count(*), min(m.user_id::text)::uuid
    into v_account_count, v_matched_user_id
  from public.club_members m
  join public.profiles p on p.id=m.user_id
  where m.organisation_id=v_organisation_id
    and m.role='owner' and m.active
    and lower(btrim(p.first_name))='keenan'
    and lower(btrim(p.last_name))='freer';

  if v_account_count <> 1 or v_matched_user_id is distinct from v_user_id then
    raise exception 'Expected exactly one active Madhouse owner profile named Keenan Freer; found %',v_account_count;
  end if;

  select * into v_assignment
  from public.club_madhouse_staff_assignments
  where id=v_assignment_id and organisation_id=v_organisation_id
  for update;

  if v_assignment.id is null or not v_assignment.active then
    raise exception 'The confirmed Keenan prepared assignment is missing or inactive';
  end if;
  if v_assignment.staff_grant_id is not null then
    raise exception 'The prepared assignment now has a staff grant; review before linking';
  end if;
  if v_assignment.canonical_name not in ('Keenan','Keenan Freer')
     or v_assignment.normalized_name not in ('keenan','keenanfreer') then
    raise exception 'The prepared assignment identity changed; review before linking';
  end if;
  if v_assignment.linked_user_id is not null and v_assignment.linked_user_id <> v_user_id then
    raise exception 'The prepared assignment is already linked to a different account';
  end if;
  if exists (
    select 1 from public.club_madhouse_staff_assignments other
    where other.organisation_id=v_organisation_id and other.linked_user_id=v_user_id
      and other.id<>v_assignment_id
  ) then
    raise exception 'Keenan Freer is already linked to another prepared assignment';
  end if;
  if exists (
    select 1 from public.club_madhouse_staff_assignments other
    where other.organisation_id=v_organisation_id and other.normalized_name='keenanfreer'
      and other.id<>v_assignment_id
  ) then
    raise exception 'A conflicting Keenan Freer assignment exists';
  end if;

  update public.club_madhouse_staff_assignments
  set linked_user_id=v_user_id, canonical_name='Keenan Freer', normalized_name='keenanfreer'
  where id=v_assignment_id and organisation_id=v_organisation_id and active
    and staff_grant_id is null
    and canonical_name in ('Keenan','Keenan Freer')
    and normalized_name in ('keenan','keenanfreer')
    and (linked_user_id is null or linked_user_id=v_user_id);
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'Guarded Keenan instructor assignment link did not update exactly one row';
  end if;
end;
$$;

commit;

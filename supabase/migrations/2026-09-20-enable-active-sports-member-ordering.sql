-- Active Sports is a member-orderable catalogue source for Madhouse. Keep
-- this invariant on future importer upserts, which historically created the
-- supplier with member_orderable=false and did not update that column.
update public.club_suppliers
set member_orderable=true, updated_at=now()
where organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and lower(btrim(name))='active sports';

create or replace function public.club_keep_madhouse_active_sports_orderable()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
     and lower(btrim(new.name))='active sports' then
    new.member_orderable=true;
  end if;
  return new;
end; $$;

drop trigger if exists club_keep_madhouse_active_sports_orderable on public.club_suppliers;
create trigger club_keep_madhouse_active_sports_orderable
before insert or update of name,organisation_id,member_orderable
on public.club_suppliers
for each row execute function public.club_keep_madhouse_active_sports_orderable();

-- Restore only contact fields omitted from completed historical imports.
-- Exact import-row/customer links are authoritative; no identity is inferred
-- from a name, email address, phone number, or household relationship.
begin;

do $$
declare t text; item record;
begin
  foreach t in array array['club_member_import_batches','club_member_import_rows','club_member_import_identities','club_customers'] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Required table public.% is missing; no contact data was changed',t;
    end if;
  end loop;
  for item in select * from (values
    ('club_member_import_rows','organisation_id'),('club_member_import_rows','batch_id'),
    ('club_member_import_rows','imported_customer_id'),('club_member_import_rows','normalized_values'),
    ('club_member_import_rows','raw_values'),('club_member_import_rows','outcome'),('club_member_import_rows','blockers'),
    ('club_member_import_batches','organisation_id'),('club_member_import_batches','source_system'),
    ('club_member_import_batches','status'),('club_member_import_batches','mapping'),
    ('club_member_import_identities','organisation_id'),('club_member_import_identities','source_system'),
    ('club_member_import_identities','source_member_reference'),('club_member_import_identities','customer_id'),
    ('club_customers','id'),('club_customers','organisation_id'),('club_customers','email'),
    ('club_customers','phone'),('club_customers','user_id'),('club_customers','updated_at')
  ) as required(table_name,column_name) loop
    if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name=item.table_name and column_name=item.column_name) then
      raise exception 'Required column public.%.% is missing; no contact data was changed',item.table_name,item.column_name;
    end if;
  end loop;
end;
$$;

with row_contacts as (
    select r.organisation_id,
      r.imported_customer_id as customer_id,
      case when r.normalized_values ? 'email'
        then nullif(lower(btrim(r.normalized_values->>'email')),'')
        else nullif(lower(btrim(coalesce(
          r.raw_values->>nullif(b.mapping->>'email',''),
          r.raw_values->>'email',r.raw_values->>'Email'
        ))),'')
      end as source_email,
      case when r.normalized_values ? 'mobile'
        then nullif(regexp_replace(btrim(r.normalized_values->>'mobile'),'[^0-9+]','','g'),'')
        when r.normalized_values ? 'phone'
        then nullif(regexp_replace(btrim(r.normalized_values->>'phone'),'[^0-9+]','','g'),'')
        else nullif(regexp_replace(btrim(coalesce(
          r.raw_values->>nullif(b.mapping->>'phone',''),
          r.raw_values->>nullif(b.mapping->>'mobile',''),
          r.raw_values->>'phone',r.raw_values->>'Phone',r.raw_values->>'mobile',r.raw_values->>'Mobile'
        )),'[^0-9+]','','g'),'')
      end as source_phone,
      c.email as existing_email,
      c.phone as existing_phone
    from public.club_member_import_rows r
    join public.club_member_import_batches b
      on b.id=r.batch_id and b.organisation_id=r.organisation_id
    join public.club_customers c
      on c.id=r.imported_customer_id and c.organisation_id=r.organisation_id
    where b.source_system='clubmanager'
      and b.status='completed'
      and r.outcome in ('imported','linked')
      and jsonb_array_length(coalesce(r.blockers,'[]'::jsonb))=0
      and r.imported_customer_id is not null
      and c.user_id is null
      and (
        nullif(btrim(coalesce(r.normalized_values->>'legacyReference',r.raw_values->>'legacy_member_reference',r.raw_values->>'member_number',r.raw_values->>'member_id',r.raw_values->>'member id',r.raw_values->>'id')),'') is null
        or exists(
          select 1 from public.club_member_import_identities i
          where i.organisation_id=r.organisation_id
            and i.source_system='clubmanager'
            and i.source_member_reference=btrim(coalesce(r.normalized_values->>'legacyReference',r.raw_values->>'legacy_member_reference',r.raw_values->>'member_number',r.raw_values->>'member_id',r.raw_values->>'member id',r.raw_values->>'id'))
            and i.customer_id=r.imported_customer_id
        )
      )
  ), grouped as (
    select organisation_id,customer_id,
      case when count(distinct source_email)=1
        and min(source_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then min(source_email) end as candidate_email,
      case when count(distinct source_phone)=1
        and min(source_phone) ~ '^\+?[0-9]{7,15}$'
        then min(source_phone) end as candidate_phone,
      bool_and(nullif(btrim(existing_email),'') is null) as email_was_blank,
      bool_and(nullif(btrim(existing_phone),'') is null) as phone_was_blank
    from row_contacts
    group by organisation_id,customer_id
  ), candidates as (
    select g.*,
      count(*) filter(where candidate_email is not null)
        over(partition by organisation_id,candidate_email) as email_candidate_count
    from grouped g
  ), changed as (
    update public.club_customers c
    set email=case
          when x.email_was_blank and x.candidate_email is not null and x.email_candidate_count=1
            and not exists(select 1 from public.club_customers other_customer
              where other_customer.organisation_id=c.organisation_id
                and other_customer.id<>c.id
                and lower(btrim(other_customer.email))=x.candidate_email)
          then x.candidate_email else c.email end,
        phone=case when x.phone_was_blank and x.candidate_phone is not null
          then x.candidate_phone else c.phone end,
        updated_at=now()
    from candidates x
    where c.id=x.customer_id
      and c.organisation_id=x.organisation_id
      and c.user_id is null
      and (
        (x.email_was_blank and x.candidate_email is not null and x.email_candidate_count=1
          and not exists(select 1 from public.club_customers other_customer
            where other_customer.organisation_id=c.organisation_id
              and other_customer.id<>c.id
              and lower(btrim(other_customer.email))=x.candidate_email))
        or (x.phone_was_blank and x.candidate_phone is not null)
      )
    returning
      (x.email_was_blank and x.candidate_email is not null and x.email_candidate_count=1
        and c.email=x.candidate_email) as email_filled,
      (x.phone_was_blank and x.candidate_phone is not null and c.phone=x.candidate_phone) as phone_filled
  )
select count(*) filter(where email_filled) as email_fields_restored,
  count(*) filter(where phone_filled) as phone_fields_restored
from changed;

commit;

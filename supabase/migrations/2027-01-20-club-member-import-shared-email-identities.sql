-- Permit separate legacy people to retain a shared household email during a
-- staff-authorised import. Shared email never becomes an automatic identity
-- link; the existing verified-email claim flow continues to require exactly
-- one eligible profile and returns an ambiguity state otherwise.
begin;

create or replace function public.club_revalidate_member_import_batch(
  p_organisation_id uuid,p_batch_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.club_member_import_batches%rowtype;
  r record;
  raw jsonb;
  m jsonb;
  norm jsonb;
  blocks jsonb;
  warns jsonb;
  ident text;
  ref text;
  person_name text;
  v_email_rows integer;
  seen text[]:='{}';
  v_user uuid;
  v_auth_count integer;
  v_customer uuid;
  v_customer_user uuid;
  v_valid integer;
  v_warn integer;
  v_block integer;
  v_conflict integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import is not permitted' using errcode='42501';
  end if;

  select * into b from public.club_member_import_batches
  where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Import batch not found' using errcode='P0002'; end if;
  m:=b.mapping;

  for r in
    select * from public.club_member_import_rows
    where batch_id=b.id and organisation_id=p_organisation_id
    order by source_row_number for update
  loop
    raw:=r.raw_values; blocks:='[]'; warns:='[]'; v_user:=null; v_customer:=null; v_customer_user:=null;
    norm:=jsonb_strip_nulls(jsonb_build_object(
      'firstName',nullif(btrim(coalesce(raw->>(m->>'firstName'),raw->>'first_name',raw->>'firstname')),''),
      'lastName',nullif(btrim(coalesce(raw->>(m->>'lastName'),raw->>'last_name',raw->>'surname')),''),
      'fullName',nullif(btrim(coalesce(raw->>(m->>'fullName'),raw->>'full_name',raw->>'name')),''),
      'email',lower(nullif(btrim(coalesce(raw->>(m->>'email'),raw->>'email')),'')),
      'phone',nullif(regexp_replace(coalesce(raw->>(m->>'phone'),raw->>'mobile',raw->>'phone'),'[^0-9+]','','g'),''),
      'legacyReference',nullif(btrim(coalesce(raw->>(m->>'legacyReference'),raw->>'legacy_member_reference',raw->>'member_number',raw->>'member_id',raw->>'member id',raw->>'id')),''),
      'membershipName',nullif(btrim(coalesce(raw->>(m->>'membershipName'),raw->>'membership_type',raw->>'membership',raw->>'package')),''),
      'membershipStatus',lower(regexp_replace(nullif(btrim(coalesce(raw->>(m->>'membershipStatus'),raw->>'membership_status',raw->>'status')),''),'[ -]+','_','g')),
      'startDate',nullif(btrim(coalesce(raw->>(m->>'startDate'),raw->>'start_date',raw->>'join_date')),''),
      'endDate',nullif(btrim(coalesce(raw->>(m->>'endDate'),raw->>'end_date',raw->>'expiry_date')),''),
      'billingMethod',nullif(btrim(coalesce(raw->>(m->>'billingMethod'),raw->>'payment_method',raw->>'billing_method')),''),
      'notes',nullif(btrim(coalesce(raw->>(m->>'notes'),raw->>'notes')),'')));

    if norm->>'membershipStatus' in ('current','live','paid','staff','free','manual') then
      norm:=jsonb_set(norm,'{membershipStatus}','"active"');
    elsif norm->>'membershipStatus' in ('ended','inactive','lapsed') then
      norm:=jsonb_set(norm,'{membershipStatus}','"expired"');
    elsif norm->>'membershipStatus' in ('canceled','terminated') then
      norm:=jsonb_set(norm,'{membershipStatus}','"cancelled"');
    end if;

    ref:=nullif(btrim(norm->>'legacyReference'),'');
    person_name:=lower(regexp_replace(btrim(coalesce(nullif(norm->>'fullName',''),concat_ws(' ',norm->>'firstName',norm->>'lastName'))),'\s+',' ','g'));
    -- Stable source duplicate key: an explicit legacy reference is strongest.
    -- Otherwise require individual name/phone evidence; email alone is never
    -- sufficient to declare two household rows the same person.
    ident:=case
      when ref is not null then 'ref:'||ref
      when coalesce(person_name,'')<>'' and coalesce(norm->>'phone','')<>'' then 'person:'||person_name||'|phone:'||(norm->>'phone')
      when coalesce(person_name,'')<>'' and coalesce(norm->>'email','')<>'' then 'person:'||person_name||'|email:'||(norm->>'email')
      when coalesce(person_name,'')<>'' then 'person:'||person_name
      when coalesce(norm->>'phone','')<>'' then 'phone:'||(norm->>'phone')
      else null end;

    if coalesce(norm->>'fullName','')='' and coalesce(norm->>'firstName','')=''
      and coalesce(norm->>'lastName','')='' and coalesce(norm->>'email','')=''
      and coalesce(norm->>'phone','')='' then
      blocks:=blocks||jsonb_build_array('A name, email, phone or external member reference is required');
    end if;
    if ident is not null and ident=any(seen) then
      blocks:=blocks||jsonb_build_array(case when ref is not null then 'Duplicate source external ID in this batch' else 'Duplicate source person in this batch' end);
    elsif ident is not null then seen:=array_append(seen,ident); end if;

    if norm->>'email' is not null and norm->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      blocks:=blocks||jsonb_build_array('Email address is malformed');
    end if;

    -- Count the batch's normalized source email from the raw rows so this is
    -- correct on the first revalidation as well as subsequent edits.
    if norm->>'email' is not null then
      select count(*) into v_email_rows
      from public.club_member_import_rows er
      where er.organisation_id=p_organisation_id and er.batch_id=b.id
        and lower(nullif(btrim(coalesce(er.raw_values->>(m->>'email'),er.raw_values->>'email')),''))=norm->>'email';
    else v_email_rows:=0; end if;

    if norm->>'membershipStatus' is not null and norm->>'membershipStatus' not in ('active','expired','cancelled') then
      blocks:=blocks||jsonb_build_array('Membership status is not recognised');
    end if;
    if norm->>'startDate' is not null and norm->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' then blocks:=blocks||jsonb_build_array('Start date must be YYYY-MM-DD'); end if;
    if norm->>'endDate' is not null and norm->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' then blocks:=blocks||jsonb_build_array('End date must be YYYY-MM-DD'); end if;
    if norm->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_char(to_date(norm->>'startDate','YYYY-MM-DD'),'YYYY-MM-DD')<>norm->>'startDate' then blocks:=blocks||jsonb_build_array('Start date is invalid'); end if;
    if norm->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_char(to_date(norm->>'endDate','YYYY-MM-DD'),'YYYY-MM-DD')<>norm->>'endDate' then blocks:=blocks||jsonb_build_array('End date is invalid'); end if;
    if norm->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$' and norm->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_date(norm->>'endDate','YYYY-MM-DD')<to_date(norm->>'startDate','YYYY-MM-DD') then blocks:=blocks||jsonb_build_array('End date cannot be before start date'); end if;
    if norm->>'email' is null then warns:=warns||jsonb_build_array('Email is missing; member remains claimable'); end if;

    if norm->>'membershipName' is not null and not exists(
      select 1 from public.club_member_import_package_mappings pm
      where pm.organisation_id=p_organisation_id and pm.batch_id=b.id and lower(pm.source_package)=lower(norm->>'membershipName')
        and pm.status='mapped' and pm.club_product_id is not null
    ) then blocks:=blocks||jsonb_build_array('Membership package mapping required'); end if;

    if ref is not null then
      select i.customer_id,c.user_id into v_customer,v_customer_user
      from public.club_member_import_identities i
      join public.club_customers c on c.id=i.customer_id and c.organisation_id=i.organisation_id
      where i.organisation_id=p_organisation_id and i.source_system='clubmanager' and i.source_member_reference=ref;
    end if;

    -- Never use shared email as a customer match. Each row in a shared-email
    -- batch remains a distinct unclaimed customer unless its legacy reference
    -- already resolves to that exact customer.
    if v_customer is null and norm->>'email' is not null and v_email_rows=1 then
      select count(*),(array_agg(c.id order by c.id))[1] into v_auth_count,v_customer
      from public.club_customers c
      where c.organisation_id=p_organisation_id and lower(btrim(c.email))=norm->>'email';
      if v_auth_count>1 then blocks:=blocks||jsonb_build_array('Multiple existing customers match this email');
      elsif v_auth_count=1 then select user_id into v_customer_user from public.club_customers where id=v_customer; end if;
    end if;

    -- A verified Auth identity may only be attached automatically when this
    -- email identifies one source person in the whole batch.
    if norm->>'email' is not null and v_email_rows=1 then
      select count(*),(array_agg(id order by id))[1] into v_auth_count,v_user
      from auth.users where lower(email)=norm->>'email' and email_confirmed_at is not null;
      if v_auth_count>1 then blocks:=blocks||jsonb_build_array('Multiple verified Auth users match this email');
      elsif v_customer_user is not null and v_user is not null and v_customer_user<>v_user then
        blocks:=blocks||jsonb_build_array('Existing customer is linked to a different identity');
      end if;
      if v_user is not null and exists(
        select 1 from public.club_customers linked
        where linked.organisation_id=p_organisation_id and linked.user_id=v_user
          and (v_customer is null or linked.id<>v_customer)
      ) then
        blocks:=blocks||jsonb_build_array('R12 account is already linked to another member profile');
        v_user:=null;
      end if;
    end if;

    update public.club_member_import_rows
    set normalized_values=norm,warnings=warns,blockers=blocks,
      matched_user_id=case when v_email_rows=1 then v_user else null end,
      imported_customer_id=case when jsonb_array_length(blocks)=0 then v_customer else null end,
      action=case when jsonb_array_length(blocks)>0 then 'invalid' when v_customer is not null then 'exact_match' else 'new' end,
      match_candidates=case when v_customer is null then '[]'::jsonb else jsonb_build_array(v_customer) end,
      updated_at=now()
    where id=r.id;
  end loop;

  select count(*) filter(where jsonb_array_length(blockers)=0),
    coalesce(sum(jsonb_array_length(warnings)),0),
    count(*) filter(where jsonb_array_length(blockers)>0),
    count(*) filter(where action='possible_match' or blockers::text ilike '%different identity%' or blockers::text ilike '%Multiple%')
  into v_valid,v_warn,v_block,v_conflict
  from public.club_member_import_rows where organisation_id=p_organisation_id and batch_id=b.id;

  update public.club_member_import_batches
  set row_count=v_valid+v_block,valid_count=v_valid,warning_count=v_warn,
    blocking_count=v_block,conflicted_count=v_conflict,rejected_count=v_block-v_conflict,
    status=case when v_valid>0 then 'review_required' else 'failed' end,updated_at=now()
  where id=b.id returning * into b;
  return to_jsonb(b);
end; $$;

revoke all on function public.club_revalidate_member_import_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_revalidate_member_import_batch(uuid,uuid) to authenticated;

commit;

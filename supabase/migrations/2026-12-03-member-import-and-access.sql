-- Launch-safe legacy member import and physical-access decision boundary.
-- Review-only: this migration provisions no devices, secrets, people or memberships.

create extension if not exists pgcrypto;

alter table public.club_member_import_batches
  add column if not exists skipped_count integer not null default 0 check (skipped_count >= 0),
  add column if not exists conflicted_count integer not null default 0 check (conflicted_count >= 0),
  add column if not exists rejected_count integer not null default 0 check (rejected_count >= 0);
alter table public.club_member_import_rows
  add column if not exists matched_user_id uuid references auth.users(id) on delete set null;
alter table public.club_memberships
  add column if not exists import_batch_id uuid references public.club_member_import_batches(id) on delete restrict,
  add column if not exists import_row_id uuid references public.club_member_import_rows(id) on delete restrict,
  add column if not exists migration_metadata jsonb;
create unique index if not exists club_member_import_checksum_uq
  on public.club_member_import_batches(organisation_id,source_system,source_checksum)
  where source_checksum is not null;
create unique index if not exists club_memberships_import_row_uq
  on public.club_memberships(import_row_id) where import_row_id is not null;

create table if not exists public.club_access_credentials (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  customer_id uuid not null,
  credential_type text not null check (credential_type in ('legacy_member_reference','barcode','qr')),
  credential_hash bytea not null,
  display_suffix text,
  status text not null default 'active' check (status in ('active','revoked')),
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), revoked_at timestamptz,
  unique (organisation_id,credential_hash),
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete cascade
);
create index if not exists club_access_credentials_customer_idx on public.club_access_credentials(organisation_id,customer_id);

create table if not exists public.club_access_devices (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, name text not null check(length(btrim(name))>0), provider_key text,
  secret_hash bytea not null, status text not null default 'active' check(status in ('active','disabled')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), last_seen_at timestamptz,
  unique(id,organisation_id), foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict
);

create table if not exists public.club_access_decisions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, customer_id uuid, membership_id uuid, device_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  decision text not null check(decision in ('allow','deny')), reason text not null,
  credential_type text not null, source text not null check(source in ('reception','device')),
  request_nonce text, decided_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
  unique(device_id,request_nonce),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(device_id,organisation_id) references public.club_access_devices(id,organisation_id) on delete restrict
);
create index if not exists club_access_decisions_recent_idx on public.club_access_decisions(organisation_id,location_id,decided_at desc);

alter table public.club_access_credentials enable row level security;
alter table public.club_access_devices enable row level security;
alter table public.club_access_decisions enable row level security;
revoke all on public.club_access_credentials,public.club_access_devices,public.club_access_decisions from public,anon,authenticated;

-- Server-derived validation. Conflicted/rejected rows remain reportable but do not
-- prevent valid rows in the same reviewed batch from importing.
create or replace function public.club_revalidate_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; raw jsonb; m jsonb; norm jsonb; blocks jsonb; warns jsonb; ident text; ref text; seen text[]:='{}'; seen_emails text[]:='{}'; v_user uuid; v_auth_count integer; v_customer uuid; v_customer_user uuid; v_valid integer; v_warn integer; v_block integer; v_conflict integer;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found then raise exception 'Import batch not found' using errcode='P0002'; end if; m:=b.mapping;
 for r in select * from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id order by source_row_number for update loop
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
  if norm->>'membershipStatus' in ('current','live','paid','staff','free','manual') then norm:=jsonb_set(norm,'{membershipStatus}','"active"');
  elsif norm->>'membershipStatus' in ('ended','inactive','lapsed') then norm:=jsonb_set(norm,'{membershipStatus}','"expired"');
  elsif norm->>'membershipStatus' in ('canceled','terminated') then norm:=jsonb_set(norm,'{membershipStatus}','"cancelled"'); end if;
  ref:=norm->>'legacyReference'; ident:=coalesce('ref:'||ref,'email:'||(norm->>'email'),'phone:'||(norm->>'phone'));
  if ident is null and coalesce(norm->>'fullName',concat_ws(' ',norm->>'firstName',norm->>'lastName'),'')='' then blocks:=blocks||jsonb_build_array('A name, email, phone or external member reference is required'); end if;
  if ident is not null and ident=any(seen) then blocks:=blocks||jsonb_build_array('Duplicate source person in this batch'); else seen:=array_append(seen,ident); end if;
  if norm->>'email' is not null and norm->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then blocks:=blocks||jsonb_build_array('Email address is malformed'); end if;
  if norm->>'email' is not null and norm->>'email'=any(seen_emails) then blocks:=blocks||jsonb_build_array('Duplicate email in this batch'); elsif norm->>'email' is not null then seen_emails:=array_append(seen_emails,norm->>'email'); end if;
  if norm->>'membershipStatus' is not null and norm->>'membershipStatus' not in ('active','expired','cancelled') then blocks:=blocks||jsonb_build_array('Membership status is not recognised'); end if;
  if norm->>'startDate' is not null and norm->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' then blocks:=blocks||jsonb_build_array('Start date must be YYYY-MM-DD'); end if;
  if norm->>'endDate' is not null and norm->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' then blocks:=blocks||jsonb_build_array('End date must be YYYY-MM-DD'); end if;
  if norm->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_char(to_date(norm->>'startDate','YYYY-MM-DD'),'YYYY-MM-DD')<>norm->>'startDate' then blocks:=blocks||jsonb_build_array('Start date is invalid'); end if;
  if norm->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_char(to_date(norm->>'endDate','YYYY-MM-DD'),'YYYY-MM-DD')<>norm->>'endDate' then blocks:=blocks||jsonb_build_array('End date is invalid'); end if;
  if norm->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$' and norm->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$' and to_date(norm->>'endDate','YYYY-MM-DD')<to_date(norm->>'startDate','YYYY-MM-DD') then blocks:=blocks||jsonb_build_array('End date cannot be before start date'); end if;
  if norm->>'email' is null then warns:=warns||jsonb_build_array('Email is missing; member remains claimable'); end if;
  if norm->>'membershipName' is not null and not exists(select 1 from public.club_member_import_package_mappings pm where pm.batch_id=b.id and lower(pm.source_package)=lower(norm->>'membershipName') and pm.status='mapped' and pm.club_product_id is not null) then blocks:=blocks||jsonb_build_array('Membership package mapping required'); end if;
  if ref is not null then select i.customer_id,c.user_id into v_customer,v_customer_user from public.club_member_import_identities i join public.club_customers c on c.id=i.customer_id and c.organisation_id=i.organisation_id where i.organisation_id=p_organisation_id and i.source_system='clubmanager' and i.source_member_reference=ref; end if;
  if v_customer is null and norm->>'email' is not null then
   select count(*),(array_agg(c.id order by c.id))[1] into v_auth_count,v_customer from public.club_customers c where c.organisation_id=p_organisation_id and lower(btrim(c.email))=norm->>'email';
   if v_auth_count>1 then blocks:=blocks||jsonb_build_array('Multiple existing customers match this email');
   elsif v_auth_count=1 then select user_id into v_customer_user from public.club_customers where id=v_customer; end if;
  end if;
  if norm->>'email' is not null then select count(*),(array_agg(id order by id))[1] into v_auth_count,v_user from auth.users where lower(email)=norm->>'email' and email_confirmed_at is not null; if v_auth_count>1 then blocks:=blocks||jsonb_build_array('Multiple verified Auth users match this email'); elsif v_customer_user is not null and v_user is not null and v_customer_user<>v_user then blocks:=blocks||jsonb_build_array('Existing customer is linked to a different identity'); end if; end if;
  update public.club_member_import_rows set normalized_values=norm,warnings=warns,blockers=blocks,matched_user_id=v_user,imported_customer_id=case when jsonb_array_length(blocks)=0 then v_customer else null end,action=case when jsonb_array_length(blocks)>0 then 'invalid' when v_customer is not null then 'exact_match' else 'new' end,match_candidates=case when v_customer is null then '[]'::jsonb else jsonb_build_array(v_customer) end,updated_at=now() where id=r.id;
 end loop;
 select count(*) filter(where jsonb_array_length(blockers)=0),coalesce(sum(jsonb_array_length(warnings)),0),count(*) filter(where jsonb_array_length(blockers)>0),count(*) filter(where action='possible_match' or blockers::text ilike '%different identity%' or blockers::text ilike '%Multiple%') into v_valid,v_warn,v_block,v_conflict from public.club_member_import_rows where batch_id=b.id;
 update public.club_member_import_batches set row_count=v_valid+v_block,valid_count=v_valid,warning_count=v_warn,blocking_count=v_block,conflicted_count=v_conflict,rejected_count=v_block-v_conflict,status=case when v_valid>0 then 'review_required' else 'failed' end,updated_at=now() where id=b.id returning * into b;
 return to_jsonb(b);
end; $$;

create or replace function public.club_create_member_import_batch(p_organisation_id uuid,p_filename text,p_checksum text,p_headers jsonb,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; item jsonb; n integer:=0;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_filename),'') is null or nullif(btrim(p_checksum),'') is null or p_checksum !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_headers)<>'array' or jsonb_typeof(p_mapping)<>'object' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid member import batch' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organisation_id::text||':'||p_checksum,0));
 select * into b from public.club_member_import_batches where organisation_id=p_organisation_id and source_system='clubmanager' and source_checksum=p_checksum;
 if found then return to_jsonb(b); end if;
 insert into public.club_member_import_batches(organisation_id,source_system,original_filename,source_checksum,uploaded_by,status,headers,mapping) values(p_organisation_id,'clubmanager',left(btrim(p_filename),255),p_checksum,auth.uid(),'validating',p_headers,p_mapping) returning * into b;
 for item in select value from jsonb_array_elements(p_rows) loop n:=n+1; insert into public.club_member_import_rows(organisation_id,batch_id,source_row_number,raw_values,normalized_values,warnings,blockers,action,match_candidates) values(p_organisation_id,b.id,coalesce((item->>'row_number')::integer,n+1),coalesce(item->'raw','{}'::jsonb),'{}','[]','[]','new','[]'); end loop;
 perform public.club_revalidate_member_import_batch(p_organisation_id,b.id); select * into b from public.club_member_import_batches where id=b.id;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.batch_created','member_import_batch',b.id,jsonb_build_object('row_count',b.row_count,'checksum',p_checksum));
 return to_jsonb(b);
end; $$;

create or replace function public.club_confirm_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 perform public.club_revalidate_member_import_batch(p_organisation_id,p_batch_id);
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.valid_count=0 then raise exception 'No valid rows are ready to import' using errcode='22023'; end if;
 update public.club_member_import_batches set status='ready',updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.authorised','member_import_batch',b.id,jsonb_build_object('accepted',b.valid_count,'conflicted',b.conflicted_count,'rejected',b.rejected_count));
 return to_jsonb(b);
end; $$;

create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; c public.club_customers%rowtype; u uuid; ref text; product uuid; ms public.club_memberships%rowtype; ms_status text; start_at timestamptz; end_at timestamptz; made integer:=0; linked integer:=0; skipped integer:=0; failed integer:=0; was_linked boolean;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.status not in ('ready','importing') then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
 update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()) where id=b.id;
 for r in select * from public.club_member_import_rows where batch_id=b.id and jsonb_array_length(blockers)=0 order by source_row_number for update loop
  begin
   if r.outcome in ('imported','linked','skipped_existing') then skipped:=skipped+1; continue; end if;
   c:=null; u:=r.matched_user_id; ref:=r.normalized_values->>'legacyReference'; was_linked:=false;
   if r.imported_customer_id is not null then select * into c from public.club_customers where id=r.imported_customer_id and organisation_id=p_organisation_id for update; end if;
   if c.id is null then insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(p_organisation_id,u,coalesce(nullif(r.normalized_values->>'fullName',''),nullif(concat_ws(' ',r.normalized_values->>'firstName',r.normalized_values->>'lastName'),''),'Imported member'),r.normalized_values->>'email',r.normalized_values->>'phone','member') returning * into c; made:=made+1;
   else linked:=linked+1; was_linked:=true; if c.user_id is null and u is not null then update public.club_customers set user_id=u,updated_at=now() where id=c.id and user_id is null returning * into c; end if; end if;
   if u is not null then insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,u,'member',true) on conflict(organisation_id,user_id) do nothing; end if;
   if ref is not null then insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id) values(p_organisation_id,'clubmanager',ref,c.id,b.id) on conflict(organisation_id,source_system,source_member_reference) do update set customer_id=excluded.customer_id where club_member_import_identities.customer_id=excluded.customer_id; if exists(select 1 from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=digest(lower(btrim(ref)),'sha256') and customer_id<>c.id) then raise exception 'Credential is already assigned to another member' using errcode='23505'; end if; insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,display_suffix) values(p_organisation_id,c.id,'legacy_member_reference',digest(lower(btrim(ref)),'sha256'),right(ref,4)) on conflict(organisation_id,credential_hash) do nothing; end if;
   if r.normalized_values->>'membershipName' is not null then
    select club_product_id into product from public.club_member_import_package_mappings where batch_id=b.id and lower(source_package)=lower(r.normalized_values->>'membershipName') and status='mapped';
    ms_status:=coalesce(r.normalized_values->>'membershipStatus','expired'); start_at:=coalesce((r.normalized_values->>'startDate')::date::timestamptz,b.created_at); end_at:=case when r.normalized_values->>'endDate' is null then null else (r.normalized_values->>'endDate')::date::timestamptz+interval '1 day' end;
    if end_at is not null and end_at<=now() then ms_status:='expired'; end if;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key,import_batch_id,import_row_id,migration_metadata) values(p_organisation_id,product,ms_status,start_at,end_at,'legacy_import','member-import:'||r.id,b.id,r.id,jsonb_build_object('source_system','clubmanager','billing_evidence','not_imported','source_status',r.normalized_values->>'membershipStatus','billing_method_label',r.normalized_values->>'billingMethod')) on conflict(organisation_id,assignment_idempotency_key) do nothing returning * into ms;
    if ms.id is null then select * into ms from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key='member-import:'||r.id; end if;
    if u is null then insert into public.club_membership_holders(membership_id,organisation_id,customer_id) values(ms.id,p_organisation_id,c.id) on conflict do nothing; else insert into public.club_membership_holders(membership_id,organisation_id,user_id) values(ms.id,p_organisation_id,u) on conflict do nothing; insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source) select u,p_organisation_id,ms.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,start_at,end_at,'legacy_import' from public.club_product_entitlements e where e.product_id=product and ms_status='active' on conflict do nothing; end if;
   end if;
   update public.club_member_import_rows set imported_customer_id=c.id,imported_membership_id=ms.id,outcome=case when was_linked then 'linked' else 'imported' end,updated_at=now() where id=r.id;
  exception when others then failed:=failed+1; update public.club_member_import_rows set outcome='rejected',blockers=blockers||jsonb_build_array('Import failed safely; review this row'),updated_at=now() where id=r.id; end;
 end loop;
 update public.club_member_import_rows set outcome='rejected' where batch_id=b.id and jsonb_array_length(blockers)>0 and outcome is null;
 update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=made,linked_count=linked,skipped_count=skipped,rejected_count=(select count(*) from public.club_member_import_rows where batch_id=b.id and outcome='rejected'),failed_count=failed,updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.completed','member_import_batch',b.id,jsonb_build_object('imported',made,'linked',linked,'skipped',skipped,'rejected',b.rejected_count));
 return public.club_list_member_import_batch(p_organisation_id,b.id);
end; $$;

create or replace function public.club_access_decide_customer(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_credential_type text,p_source text,p_device_id uuid default null,p_nonce text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; m record; allowed boolean:=false; why text:='no_membership'; audit_id uuid; billing_block boolean:=false;
begin
 select ms.*,null::text as scope,null::uuid[] as location_ids into m from public.club_memberships ms where false;
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
 if not found then why:='credential_not_found';
 elsif not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then why:='location_inactive';
 else
  select ms.*,pe.scope,pe.location_ids into m from public.club_memberships ms join public.club_membership_holders h on h.membership_id=ms.id and h.organisation_id=ms.organisation_id join public.club_product_entitlements pe on pe.product_id=ms.product_id and pe.entitlement_key='gym_access' where ms.organisation_id=p_organisation_id and (h.customer_id=c.id or h.user_id=c.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1;
  if not found then why:='no_membership'; elsif m.status='cancelled' then why:='membership_cancelled'; elsif m.status<>'active' then why:='membership_inactive'; elsif m.starts_at>now() then why:='membership_not_started'; elsif m.ends_at is not null and m.ends_at<=now() then why:='membership_expired'; elsif not (m.scope='future_locations' or (m.scope='organisation' and (coalesce(cardinality(m.location_ids),0)=0 or p_location_id=any(m.location_ids))) or (m.scope='locations' and p_location_id=any(m.location_ids))) then why:='wrong_club_location'; else
   select exists(select 1 from public.club_membership_billing_arrangements a join public.club_membership_billing_policies bp on bp.organisation_id=a.organisation_id and bp.access_suspension_enabled join public.club_membership_billing_obligations o on o.arrangement_id=a.id where a.membership_id=m.id and o.state in ('overdue','cancelled') and (o.recovery_exhausted_at is not null or o.state='cancelled')) into billing_block;
   if billing_block then why:='payment_action_required'; else allowed:=true; why:='active_entitlement'; end if;
  end if;
 end if;
 insert into public.club_access_decisions(organisation_id,location_id,customer_id,membership_id,device_id,actor_user_id,decision,reason,credential_type,source,request_nonce) values(p_organisation_id,p_location_id,c.id,m.id,p_device_id,auth.uid(),case when allowed then 'allow' else 'deny' end,why,p_credential_type,p_source,p_nonce) returning id into audit_id;
 return jsonb_build_object('allowed',allowed,'decision',case when allowed then 'allow' else 'deny' end,'reason',why,'member',case when c.id is null then null else jsonb_build_object('customerId',c.id,'displayName',c.display_name) end,'membership',case when m.id is null then null else jsonb_build_object('id',m.id,'status',m.status,'source',m.source,'startsAt',m.starts_at,'endsAt',m.ends_at) end,'decidedAt',now(),'auditReference',audit_id);
end; $$;

create or replace function public.club_reception_access_decision(p_organisation_id uuid,p_location_id uuid,p_credential text,p_credential_type text default 'legacy_member_reference')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid; a uuid;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then raise exception 'Access decisions require reception authority' using errcode='42501'; end if;
 if nullif(btrim(p_credential),'') is null or p_credential_type not in ('legacy_member_reference','barcode','qr') then raise exception 'Invalid access credential' using errcode='22023'; end if;
 select customer_id into c from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active';
 if c is null and exists(select 1 from public.club_access_credentials where organisation_id<>p_organisation_id and credential_hash=digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active') then insert into public.club_access_decisions(organisation_id,location_id,actor_user_id,decision,reason,credential_type,source) values(p_organisation_id,p_location_id,auth.uid(),'deny','wrong_club',p_credential_type,'reception') returning id into a; return jsonb_build_object('allowed',false,'decision','deny','reason','wrong_club','decidedAt',now(),'auditReference',a); end if;
 return public.club_access_decide_customer(p_organisation_id,p_location_id,c,p_credential_type,'reception');
end; $$;

create or replace function public.club_reception_customer_access_decision(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then raise exception 'Access decisions require reception authority' using errcode='42501'; end if;
 return public.club_access_decide_customer(p_organisation_id,p_location_id,p_customer_id,'manual_search','reception');
end; $$;

create or replace function public.club_device_access_decision(p_device_id uuid,p_secret text,p_nonce text,p_presented_at timestamptz,p_credential text,p_credential_type text default 'legacy_member_reference')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_access_devices%rowtype; c uuid; a uuid;
begin
 select * into d from public.club_access_devices where id=p_device_id and status='active' and secret_hash=digest(p_secret,'sha256') for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_presented_at is null or abs(extract(epoch from (now()-p_presented_at)))>120 or nullif(btrim(p_nonce),'') is null then raise exception 'Stale or invalid device request' using errcode='22023'; end if;
 if exists(select 1 from public.club_access_decisions where device_id=d.id and request_nonce=p_nonce) then raise exception 'Device request replayed' using errcode='23505'; end if;
 if (select count(*) from public.club_access_decisions where device_id=d.id and decided_at>now()-interval '1 minute')>=120 then raise exception 'Device rate limit exceeded' using errcode='54000'; end if;
 select customer_id into c from public.club_access_credentials where organisation_id=d.organisation_id and credential_hash=digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active';
 update public.club_access_devices set last_seen_at=now() where id=d.id;
 if c is null and exists(select 1 from public.club_access_credentials where organisation_id<>d.organisation_id and credential_hash=digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active') then insert into public.club_access_decisions(organisation_id,location_id,device_id,decision,reason,credential_type,source,request_nonce) values(d.organisation_id,d.location_id,d.id,'deny','wrong_club',p_credential_type,'device',p_nonce) returning id into a; return jsonb_build_object('allowed',false,'decision','deny','reason','wrong_club','decidedAt',now(),'auditReference',a); end if;
 return public.club_access_decide_customer(d.organisation_id,d.location_id,c,p_credential_type,'device',d.id,p_nonce);
end; $$;

revoke all on function public.club_revalidate_member_import_batch(uuid,uuid),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid),public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text),public.club_reception_access_decision(uuid,uuid,text,text),public.club_reception_customer_access_decision(uuid,uuid,uuid),public.club_device_access_decision(uuid,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.club_revalidate_member_import_batch(uuid,uuid),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid),public.club_reception_access_decision(uuid,uuid,text,text),public.club_reception_customer_access_decision(uuid,uuid,uuid) to authenticated;
grant execute on function public.club_device_access_decision(uuid,text,text,timestamptz,text,text) to service_role;

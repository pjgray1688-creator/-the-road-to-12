-- Production-safe shared-account deletion executor. Forward-only: this extends
-- the 2026-10-20 request queue and never assumes that a retention period exists.
-- It deliberately does not cancel or mutate memberships, payment agreements,
-- subscriptions, Stripe/GoCardless records, checkout or provider configuration.

alter table public.account_deletion_requests
  add column if not exists execution_state text not null default 'awaiting_review',
  add column if not exists retention_plan jsonb,
  add column if not exists plan_hash text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewer_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approver_name text,
  add column if not exists approved_at timestamptz,
  add column if not exists notification_ciphertext text,
  add column if not exists notification_expires_at timestamptz,
  add column if not exists dependency_inventory jsonb,
  add column if not exists blockers jsonb not null default '[]'::jsonb,
  add column if not exists storage_inventory jsonb not null default '[]'::jsonb,
  add column if not exists data_prepared_at timestamptz,
  add column if not exists auth_deleted_at timestamptz,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists notification_delivery_token uuid,
  add column if not exists failure_code text;

alter table public.account_deletion_requests drop constraint if exists account_deletion_requests_execution_state_check;
alter table public.account_deletion_requests add constraint account_deletion_requests_execution_state_check check (execution_state in
  ('awaiting_review','awaiting_second_approval','approved','data_prepared','notification_pending','notification_sending','completed','held','failed'));

create table if not exists public.account_deletion_execution_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_deletion_requests(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null check(length(btrim(actor_name)) between 2 and 160),
  event_type text not null,
  from_state text not null,
  to_state text not null,
  plan_hash text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.account_deletion_execution_events enable row level security;
revoke all on table public.account_deletion_execution_events from public,anon,authenticated;

create or replace function public.r12_prevent_deletion_execution_event_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and old.actor_user_id is not null and new.actor_user_id is null
     and (to_jsonb(old)-'actor_user_id')=(to_jsonb(new)-'actor_user_id') then return new; end if;
  raise exception 'Account deletion execution events are immutable' using errcode='42501';
end; $$;
revoke all on function public.r12_prevent_deletion_execution_event_mutation() from public,anon,authenticated,service_role;
drop trigger if exists account_deletion_execution_events_immutable on public.account_deletion_execution_events;
create trigger account_deletion_execution_events_immutable before update or delete on public.account_deletion_execution_events
for each row execute function public.r12_prevent_deletion_execution_event_mutation();

-- Policies are exact table/column rules. Unknown subject columns fail closed.
create table if not exists public.account_deletion_relation_policies (
  schema_name text not null default 'public', table_name text not null, column_name text not null,
  action text not null check(action in ('delete','unlink','anonymize_customer','archive_glow_age','retain','block')),
  category text not null, rationale text not null, priority integer not null default 100,
  primary key(schema_name,table_name,column_name)
);
alter table public.account_deletion_relation_policies enable row level security;
revoke all on table public.account_deletion_relation_policies from public,anon,authenticated;

create table if not exists public.account_deletion_retained_evidence (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.account_deletion_requests(id) on delete restrict,
  category text not null, source_table text not null, source_record_reference text not null,
  evidence jsonb not null, retained_at timestamptz not null default now(),
  unique(request_id,source_table,source_record_reference)
);
alter table public.account_deletion_retained_evidence enable row level security;
revoke all on table public.account_deletion_retained_evidence from public,anon,authenticated;

-- A Glow session request is an operational record, not the membership itself.
-- Preserve it while removing its Auth link. This migration does not alter usage,
-- credit, payment, checkout, subscription or provider state.
do $$ declare constraint_name text; begin
 if to_regclass('public.club_glow_session_requests') is not null then
   alter table public.club_glow_session_requests alter column user_id drop not null;
   select con.conname into constraint_name from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace join pg_class rc on rc.oid=con.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
    where n.nspname='public' and c.relname='club_glow_session_requests' and con.contype='f' and rn.nspname='auth' and rc.relname='users'
      and con.conkey=array[(select attnum from pg_attribute where attrelid=c.oid and attname='user_id')]::smallint[] limit 1;
   if constraint_name is not null then execute format('alter table public.club_glow_session_requests drop constraint %I',constraint_name); end if;
   alter table public.club_glow_session_requests add constraint club_glow_session_requests_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
 end if;
 if to_regclass('public.club_glow_adjustments') is not null then alter table public.club_glow_adjustments alter column user_id drop not null; end if;
end $$;

insert into public.account_deletion_relation_policies(schema_name,table_name,column_name,action,category,rationale,priority) values
 ('public','profiles','id','delete','profile','R12 profile and embedded training preferences are eligible personal data',900),
 ('public','whoop_connections','user_id','delete','whoop','WHOOP credentials and tokens must be erased',100),
 ('public','whoop_records','user_id','delete','whoop','WHOOP records are eligible wellness data',110),
 ('public','daily_activity','user_id','delete','measurements','Personal activity measurements are eligible data',120),
 ('public','workout_sessions','user_id','delete','training','Personal workout history is eligible data',200),
 ('public','workout_sets','user_id','delete','training','Personal workout sets are eligible data',190),
 ('public','workout_cardio','user_id','delete','training','Personal cardio history is eligible data',190),
 ('public','workout_import_receipts','user_id','delete','training','Personal workout import receipts are eligible data',180),
 ('public','training_availability_overrides','user_id','delete','training','Personal training preferences are eligible data',210),
 ('public','training_occurrence_outcomes','user_id','delete','training','Personal training outcomes are eligible data',210),
 ('public','training_occurrence_adjustments','user_id','delete','training','Personal training adjustments are eligible data',210),
 ('public','nutrition_plans','client_user_id','delete','nutrition','Client nutrition data is eligible health data',240),
 ('public','nutrition_plans','owner_coach_user_id','block','coaching','A coach-owned client plan requires separate client-data review',20),
 ('public','nutrition_daily_checkins','client_user_id','delete','nutrition','Client check-ins are eligible health data',230),
 ('public','nutrition_coach_feedback','client_user_id','delete','nutrition','Feedback about the deleting client is eligible data',220),
 ('public','nutrition_coach_feedback','coach_user_id','block','coaching','Coach-authored feedback about another person requires review',20),
 ('public','coach_programmes','client_user_id','delete','coaching','Programme data about the deleting client is eligible data',260),
 ('public','coach_programmes','owner_coach_user_id','block','coaching','Coach-owned programmes for other people require review',20),
 ('public','coach_session_logs','client_user_id','delete','coaching','Session data about the deleting client is eligible data',250),
 ('public','coach_session_logs','coach_user_id','block','coaching','Coach-authored records about another person require review',20),
 ('public','coach_relationships','client_user_id','delete','coaching','The deleting client relationship is eligible data',270),
 ('public','coach_relationships','coach_user_id','block','A coach relationship affects another person and requires review',20),
 ('public','coach_access','user_id','delete','access','Coach platform access is separate from identity',300),
 ('public','coach_permissions','user_id','delete','access','Club-granted coach access is revoked without changing memberships',300),
 ('public','coach_client_assignments','client_user_id','delete','coaching','Assignments about the deleting client are removed',280),
 ('public','coach_client_assignments','coach_user_id','block','Coach assignments affecting clients require review',20),
 ('public','club_members','user_id','delete','access','Club application role access is revoked separately from memberships',400),
 ('public','club_membership_holders','user_id','delete','membership','Remove only the Auth linkage; preserve the membership record',410),
 ('public','club_customers','user_id','anonymize_customer','membership','Unlink and de-identify the customer while preserving business records',420),
 ('public','club_glow_age_verifications','user_id','archive_glow_age','safety','Retain a de-identified age-verification audit and erase date of birth',430),
 ('public','club_glow_session_requests','user_id','unlink','transactions_refunds','Preserve the operational request while removing the Auth link',440),
 ('public','club_glow_adjustments','user_id','unlink','transactions_refunds','Preserve the adjustment ledger while removing the Auth link',450),
 ('public','account_deletion_requests','user_id','retain','audit','Request evidence is retained with restricted access',990)
on conflict(schema_name,table_name,column_name) do nothing;

-- Existing nullable SET NULL references already document the owning schema's
-- unlink semantics. Snapshot them as explicit policies at migration time.
insert into public.account_deletion_relation_policies(schema_name,table_name,column_name,action,category,rationale,priority)
select n.nspname,c.relname,a.attname,'unlink','retained_business_record','Existing nullable Auth FK explicitly preserves the record with ON DELETE SET NULL',500
from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace
join pg_class rc on rc.oid=fk.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
join unnest(fk.conkey) with ordinality keys(attnum,ord) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=keys.attnum
where fk.contype='f' and rn.nspname='auth' and rc.relname='users' and fk.confdeltype='n' and not a.attnotnull
on conflict(schema_name,table_name,column_name) do nothing;

create or replace function public.r12_deletion_service_guard()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Account deletion execution is not permitted' using errcode='42501'; end if;
 update public.account_deletion_requests set notification_ciphertext=null,notification_expires_at=null,updated_at=now()
  where notification_expires_at<=now() and notification_ciphertext is not null and execution_state<>'completed';
end; $$;
revoke all on function public.r12_deletion_service_guard() from public,anon,authenticated;

create or replace function public.r12_get_account_deletion_review_target(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard();
 if p_operator_id is null then raise exception 'Named operator required' using errcode='42501'; end if;
 select * into r from public.account_deletion_requests where id=p_request_id and status in ('requested','in_progress') for update;
 if not found or r.user_id=p_operator_id or r.execution_state not in ('awaiting_review','held') then raise exception 'Request is not reviewable by this operator' using errcode='22023'; end if;
 return jsonb_build_object('user_id',r.user_id);
end; $$;

create or replace function public.r12_review_account_deletion(p_request_id uuid,p_operator_id uuid,p_operator_name text,p_retention_plan jsonb,p_response_message text,p_notification_ciphertext text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; v_hash text; category text; decision jsonb; old_state text;
begin
 perform public.r12_deletion_service_guard();
 if p_operator_id is null or length(btrim(coalesce(p_operator_name,''))) not between 2 and 160
    or length(coalesce(p_notification_ciphertext,''))<20 or length(btrim(coalesce(p_response_message,''))) not between 1 and 600
    or jsonb_typeof(p_retention_plan) is distinct from 'object' then raise exception 'Invalid reviewed deletion plan' using errcode='22023'; end if;
 foreach category in array array['accounting','membership','transactions_refunds','safety','audit'] loop
   decision:=p_retention_plan->category;
   if decision->>'decision' not in ('retain','hold') or length(btrim(coalesce(decision->>'rationale',''))) not between 3 and 500 then raise exception 'Every retention category needs a decision and rationale' using errcode='22023'; end if;
 end loop;
 select * into r from public.account_deletion_requests where id=p_request_id and status in ('requested','in_progress') for update;
 if not found or r.user_id=p_operator_id or r.execution_state not in ('awaiting_review','held') then raise exception 'Request is not reviewable by this operator' using errcode='22023'; end if;
 old_state:=r.execution_state;
 v_hash:=md5(p_retention_plan::text||':'||r.user_id::text||':'||p_operator_id::text);
 update public.account_deletion_requests set status='in_progress',execution_state='awaiting_second_approval',retention_plan=p_retention_plan,
  plan_hash=v_hash,reviewed_by=p_operator_id,reviewer_name=btrim(p_operator_name),reviewed_at=now(),approved_by=null,approver_name=null,approved_at=null,
  notification_ciphertext=p_notification_ciphertext,notification_expires_at=now()+interval '30 days',response_message=btrim(p_response_message),
  blockers='[]',failure_code=null,updated_at=now() where id=r.id returning * into r;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,btrim(p_operator_name),'retention_review_recorded',old_state,'awaiting_second_approval',v_hash,jsonb_build_object('retention_plan',p_retention_plan));
 return jsonb_build_object('id',r.id,'state',r.execution_state,'plan_hash',v_hash);
end; $$;

create or replace function public.r12_approve_account_deletion(p_request_id uuid,p_operator_id uuid,p_operator_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard();
 select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or r.execution_state<>'awaiting_second_approval' or r.reviewed_by=p_operator_id or r.user_id=p_operator_id or p_operator_id is null
    or length(btrim(coalesce(p_operator_name,''))) not between 2 and 160 or r.plan_hash is null
    or r.plan_hash<>md5(r.retention_plan::text||':'||r.user_id::text||':'||r.reviewed_by::text) then raise exception 'Independent approval of the unchanged plan is required' using errcode='22023'; end if;
 update public.account_deletion_requests set execution_state='approved',approved_by=p_operator_id,approver_name=btrim(p_operator_name),approved_at=now(),updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,btrim(p_operator_name),'independent_approval_recorded',r.execution_state,'approved',r.plan_hash,jsonb_build_object('reviewer_id',r.reviewed_by));
 return jsonb_build_object('id',r.id,'state','approved','plan_hash',r.plan_hash);
end; $$;

create or replace function public.r12_get_account_deletion_execution_secret(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard();
 select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.approved_by is null or r.reviewed_by=r.approved_by
    or r.execution_state not in ('approved','data_prepared','notification_pending','failed')
    or r.notification_ciphertext is null then raise exception 'Approved execution is not available' using errcode='22023'; end if;
 return jsonb_build_object('request_id',r.id,'user_id',r.user_id,'execution_state',r.execution_state,
   'notification_ciphertext',r.notification_ciphertext,'notification_expires_at',r.notification_expires_at);
end; $$;

create or replace function public.r12_prepare_account_deletion(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; item record; v_count bigint; v_inventory jsonb:='[]'; v_blockers jsonb:='[]'; v_storage jsonb:='[]'; old_state text; v_predicate text; v_key text; v_other_before jsonb:='{}'; v_other_after jsonb:='{}';
begin
 perform public.r12_deletion_service_guard(); perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or r.approved_by is null or r.reviewed_by=r.approved_by or p_operator_id is distinct from r.approved_by
    or r.plan_hash<>md5(r.retention_plan::text||':'||r.user_id::text||':'||r.reviewed_by::text) then raise exception 'The named approving operator must execute the unchanged deletion plan' using errcode='22023'; end if;
 if r.execution_state in ('data_prepared','notification_pending','failed') and r.data_prepared_at is not null then
   update public.account_deletion_requests set execution_state=case when auth_deleted_at is null then 'data_prepared' else 'notification_pending' end,failure_code=null,updated_at=now() where id=r.id;
   return jsonb_build_object('state',case when r.auth_deleted_at is null then 'data_prepared' else 'notification_pending' end,'storage_objects',r.storage_inventory);
 end if;
 if r.execution_state<>'approved' then raise exception 'Deletion is not ready to execute' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(r.retention_plan) x where x.value->>'decision'='hold') then
   v_blockers:=jsonb_build_array(jsonb_build_object('code','retention_hold','message','One or more retention decisions remain on hold'));
 end if;
 -- Inventory every UUID column whose name can identify a user. Only exact UUID matches are counted.
 for item in select c.table_schema,c.table_name,c.column_name,p.action,p.category
   from information_schema.columns c left join public.account_deletion_relation_policies p on p.schema_name=c.table_schema and p.table_name=c.table_name and p.column_name=c.column_name
   where c.table_schema='public' and c.data_type='uuid' and (c.column_name='id' and c.table_name='profiles' or c.column_name ~ '(user_id|_by)$')
 loop
   execute format('select count(*) from %I.%I where %I=$1',item.table_schema,item.table_name,item.column_name) into v_count using r.user_id;
   if v_count>0 then
     v_inventory:=v_inventory||jsonb_build_array(jsonb_build_object('schema',item.table_schema,'table',item.table_name,'column',item.column_name,'rows',v_count,'action',item.action,'category',item.category));
     if item.action is null or item.action='block' then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code',case when item.action='block' then 'review_required' else 'unreviewed_dependency' end,'table',item.table_name,'column',item.column_name,'rows',v_count)); end if;
   end if;
 end loop;
 if to_regclass('storage.objects') is not null then
   execute 'select coalesce(jsonb_agg(jsonb_build_object(''bucket_id'',bucket_id,''name'',name) order by bucket_id,name),''[]''::jsonb) from storage.objects where owner_id::text=$1::text or metadata->>''user_id''=$1::text or name=$1::text or name like ($1::text||''/%'')' into v_storage using r.user_id;
 end if;
 if jsonb_array_length(v_blockers)>0 then
   update public.account_deletion_requests set execution_state='held',dependency_inventory=v_inventory,storage_inventory=v_storage,blockers=v_blockers,failure_code=null,updated_at=now() where id=r.id;
   insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
   values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'execution_held',r.execution_state,'held',r.plan_hash,jsonb_build_object('blockers',v_blockers,'inventory',v_inventory));
   return jsonb_build_object('state','held','blockers',v_blockers);
 end if;
 old_state:=r.execution_state;
 -- Snapshot rows that have no subject UUID in any mutated subject column. The
 -- same counts must remain after mutation; this is an additional isolation
 -- guard on top of every statement's exact UUID predicate.
 for item in select distinct p.schema_name,p.table_name from public.account_deletion_relation_policies p
   where p.action in ('delete','unlink','anonymize_customer','archive_glow_age') and to_regclass(format('%I.%I',p.schema_name,p.table_name)) is not null
 loop
   select string_agg(format('%I is not distinct from $1',p.column_name),' or ') into v_predicate from public.account_deletion_relation_policies p
    where p.schema_name=item.schema_name and p.table_name=item.table_name and p.action in ('delete','unlink','anonymize_customer','archive_glow_age');
   execute format('select count(*) from %I.%I where not (%s)',item.schema_name,item.table_name,v_predicate) into v_count using r.user_id;
   v_key:=item.schema_name||'.'||item.table_name; v_other_before:=jsonb_set(v_other_before,array[v_key],to_jsonb(v_count),true);
 end loop;
 -- Highest priority first; every mutation is exact UUID-scoped.
 for item in select p.* from public.account_deletion_relation_policies p where p.action in ('delete','unlink','anonymize_customer','archive_glow_age') and to_regclass(format('%I.%I',p.schema_name,p.table_name)) is not null order by p.priority
 loop
   if item.action='delete' then execute format('delete from %I.%I where %I=$1',item.schema_name,item.table_name,item.column_name) using r.user_id;
   elsif item.action='unlink' then execute format('update %I.%I set %I=null where %I=$1',item.schema_name,item.table_name,item.column_name,item.column_name) using r.user_id;
   elsif item.action='anonymize_customer' then execute format('update %I.%I set user_id=null,display_name=$2,email=null,phone=null,updated_at=now() where user_id=$1',item.schema_name,item.table_name) using r.user_id,'Deleted R12 account';
   else
     insert into public.account_deletion_retained_evidence(request_id,category,source_table,source_record_reference,evidence)
     select r.id,'safety','club_glow_age_verifications',organisation_id::text,
       jsonb_build_object('organisation_id',organisation_id,'status',status,'verified_at',verified_at,'verification_method',verification_method)
     from public.club_glow_age_verifications where user_id=r.user_id on conflict do nothing;
     delete from public.club_glow_age_verifications where user_id=r.user_id;
   end if;
 end loop;
 for item in select distinct p.schema_name,p.table_name from public.account_deletion_relation_policies p
   where p.action in ('delete','unlink','anonymize_customer','archive_glow_age') and to_regclass(format('%I.%I',p.schema_name,p.table_name)) is not null
 loop
   select string_agg(format('%I is not distinct from $1',p.column_name),' or ') into v_predicate from public.account_deletion_relation_policies p
    where p.schema_name=item.schema_name and p.table_name=item.table_name and p.action in ('delete','unlink','anonymize_customer','archive_glow_age');
   execute format('select count(*) from %I.%I where not (%s)',item.schema_name,item.table_name,v_predicate) into v_count using r.user_id;
   v_key:=item.schema_name||'.'||item.table_name; v_other_after:=jsonb_set(v_other_after,array[v_key],to_jsonb(v_count),true);
 end loop;
 if v_other_before<>v_other_after then raise exception 'Cross-account isolation validation failed' using errcode='40001'; end if;
 -- No direct Auth FK may remain. This protects against unchecked cascades.
 for item in select n.nspname schema_name,c.relname table_name,a.attname column_name
   from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_class rc on rc.oid=fk.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
   join unnest(fk.conkey) keys(attnum) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=keys.attnum
   where fk.contype='f' and rn.nspname='auth' and rc.relname='users'
 loop
   execute format('select count(*) from %I.%I where %I=$1',item.schema_name,item.table_name,item.column_name) into v_count using r.user_id;
   if v_count>0 then raise exception 'Reviewed deletion policy left a restrictive Auth dependency: %.%.%',item.schema_name,item.table_name,item.column_name using errcode='23503'; end if;
 end loop;
 update public.account_deletion_requests set execution_state='data_prepared',dependency_inventory=v_inventory,storage_inventory=v_storage,blockers='[]',data_prepared_at=now(),failure_code=null,updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'eligible_data_prepared',old_state,'data_prepared',r.plan_hash,jsonb_build_object('inventory',v_inventory,'storage_object_count',jsonb_array_length(v_storage),'unrelated_row_counts',v_other_after));
 return jsonb_build_object('state','data_prepared','storage_objects',v_storage);
end; $$;

create or replace function public.r12_confirm_account_deletion_storage(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; remaining bigint:=0;
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.execution_state not in ('data_prepared','failed') or r.data_prepared_at is null then raise exception 'Storage validation is not available' using errcode='22023'; end if;
 if to_regclass('storage.objects') is not null then execute 'select count(*) from storage.objects where owner_id::text=$1::text or metadata->>''user_id''=$1::text or name=$1::text or name like ($1::text||''/%'')' into remaining using r.user_id; end if;
 if remaining<>0 then raise exception 'Reviewed Storage objects remain' using errcode='23503'; end if;
 return jsonb_build_object('state','storage_cleared');
end; $$;

create or replace function public.r12_confirm_account_deletion_identity(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.data_prepared_at is null or exists(select 1 from auth.users where id=r.user_id) then raise exception 'Auth deletion is not confirmed' using errcode='23503'; end if;
 update public.account_deletion_requests set execution_state='notification_pending',auth_deleted_at=coalesce(auth_deleted_at,now()),failure_code=null,updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'auth_identity_deletion_confirmed',r.execution_state,'notification_pending',r.plan_hash,jsonb_build_object('exact_subject',r.user_id,'cross_account_isolation','validated_before_auth_deletion'));
 return jsonb_build_object('state','notification_pending');
end; $$;

create or replace function public.r12_claim_account_deletion_notification(p_request_id uuid,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; token uuid:=gen_random_uuid();
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.execution_state<>'notification_pending' or r.auth_deleted_at is null then raise exception 'Notification is not claimable' using errcode='22023'; end if;
 update public.account_deletion_requests set execution_state='notification_sending',notification_delivery_token=token,updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'notification_delivery_claimed',r.execution_state,'notification_sending',r.plan_hash,jsonb_build_object('delivery_token',token));
 return jsonb_build_object('state','notification_sending','delivery_token',token);
end; $$;

create or replace function public.r12_release_account_deletion_notification(p_request_id uuid,p_operator_id uuid,p_delivery_token uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.execution_state<>'notification_sending' or r.notification_delivery_token is distinct from p_delivery_token
    or length(coalesce(p_failure_code,'')) not between 1 and 100 then raise exception 'Notification release is invalid' using errcode='22023'; end if;
 update public.account_deletion_requests set execution_state='notification_pending',notification_delivery_token=null,failure_code='notification_delivery_failed',updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'notification_delivery_failed',r.execution_state,'notification_pending',r.plan_hash,jsonb_build_object('failure_code',p_failure_code));
 return jsonb_build_object('state','notification_pending');
end; $$;

create or replace function public.r12_complete_account_deletion(p_request_id uuid,p_operator_id uuid,p_delivery_token uuid,p_delivery_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or r.execution_state<>'notification_sending' or r.notification_delivery_token is distinct from p_delivery_token or r.auth_deleted_at is null or length(coalesce(p_delivery_reference,''))<1 then raise exception 'Completion requirements are not satisfied' using errcode='22023'; end if;
 update public.account_deletion_requests set status='completed',execution_state='completed',completed_at=now(),notification_sent_at=now(),notification_ciphertext=null,notification_expires_at=null,
  notification_delivery_token=null,response_message='Your shared R12 account has been deleted. Separately managed services and retained restricted records are not automatically cancelled.',updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'completion_notified',r.execution_state,'completed',r.plan_hash,jsonb_build_object('delivery_reference',p_delivery_reference));
 return jsonb_build_object('id',r.id,'state','completed','status','completed');
end; $$;

create or replace function public.r12_fail_account_deletion(p_request_id uuid,p_operator_id uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 perform public.r12_deletion_service_guard(); select * into r from public.account_deletion_requests where id=p_request_id for update;
 if not found or p_operator_id is distinct from r.approved_by or p_failure_code not in ('storage_removal_failed','auth_identity_deletion_failed','auth_identity_still_present') then raise exception 'Invalid deletion failure' using errcode='22023'; end if;
 update public.account_deletion_requests set execution_state='failed',failure_code=p_failure_code,response_message='Account deletion is incomplete and requires privacy-operator attention.',updated_at=now() where id=r.id;
 insert into public.account_deletion_execution_events(request_id,actor_user_id,actor_name,event_type,from_state,to_state,plan_hash,evidence)
 values(r.id,p_operator_id,coalesce(r.approver_name,'Approved operator'),'execution_failed',r.execution_state,'failed',r.plan_hash,jsonb_build_object('failure_code',p_failure_code));
 return jsonb_build_object('state','failed','failure_code',p_failure_code);
end; $$;

-- Remove the legacy ability for one operator to attest completion manually.
create or replace function public.r12_process_account_deletion_request(p_request_id uuid,p_operator_id uuid,p_status text,p_response_message text,p_retention_reviewed boolean default false,p_eligible_data_processed boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.r12_deletion_service_guard();
 raise exception 'Use the reviewed two-person account deletion workflow' using errcode='42501';
end; $$;

create or replace function public.r12_list_account_deletion_requests()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.r12_deletion_service_guard();
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user_id',r.user_id,'status',r.status,'execution_state',r.execution_state,'requested_at',r.requested_at,'response_due_at',r.response_due_at,'response_message',r.response_message,'reviewer_name',r.reviewer_name,'approver_name',r.approver_name,'blockers',r.blockers,'failure_code',r.failure_code) order by r.requested_at)
 from public.account_deletion_requests r where r.status in ('requested','in_progress') or r.execution_state in ('notification_pending','held','failed')),'[]'::jsonb);
end; $$;

create or replace function public.r12_get_own_account_deletion_request()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to view the request' using errcode='42501'; end if;
 select * into r from public.account_deletion_requests where user_id=auth.uid() order by requested_at desc limit 1;
 if not found then return jsonb_build_object('status','none'); end if;
 return jsonb_build_object('id',r.id,'status',r.status,'execution_state',r.execution_state,'requested_at',r.requested_at,'response_due_at',r.response_due_at,'response_message',r.response_message,'updated_at',r.updated_at,'completed_at',r.completed_at);
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('r12_get_account_deletion_review_target','r12_review_account_deletion','r12_approve_account_deletion','r12_get_account_deletion_execution_secret','r12_prepare_account_deletion','r12_confirm_account_deletion_storage','r12_confirm_account_deletion_identity','r12_claim_account_deletion_notification','r12_release_account_deletion_notification','r12_complete_account_deletion','r12_fail_account_deletion')
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;
revoke all on function public.r12_process_account_deletion_request(uuid,uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.r12_process_account_deletion_request(uuid,uuid,text,text,boolean,boolean) to service_role;
revoke all on function public.r12_list_account_deletion_requests() from public,anon,authenticated;
grant execute on function public.r12_list_account_deletion_requests() to service_role;
revoke all on function public.r12_get_own_account_deletion_request() from public,anon;
grant execute on function public.r12_get_own_account_deletion_request() to authenticated;

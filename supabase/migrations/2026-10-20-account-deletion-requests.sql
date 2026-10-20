-- Private account-deletion request queue and service-role-only operational workflow.
-- This schema is independent of Club and payment schemas. Processing events record
-- an authorised operator's retention review and deletion/anonymisation attestation;
-- this migration never deletes Auth users, memberships, billing or audit records.
-- Account deletion is an authenticated request queue. Actual deletion and any
-- legally required retention remain an authorised, reviewed operational step.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'requested' check (status in ('requested','in_progress','completed','unable_to_complete')),
  requested_at timestamptz not null default now(),
  response_due_at timestamptz not null default (now() + interval '1 month'),
  response_message text,
  reauthenticated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  check ((status = 'completed') = (completed_at is not null))
);
create unique index if not exists account_deletion_one_open_request_idx
  on public.account_deletion_requests(user_id) where status in ('requested','in_progress');
alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;

-- Every change to a request has an operator-attributed immutable event row.
create table if not exists public.account_deletion_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_deletion_requests(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  from_status text not null,
  to_status text not null,
  response_message text not null,
  retention_reviewed boolean not null default false,
  eligible_data_processed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.account_deletion_request_events enable row level security;
revoke all on table public.account_deletion_request_events from public, anon, authenticated;

create or replace function public.r12_submit_account_deletion_request(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; new_request boolean:=false;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise exception 'Account deletion request is not permitted' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into r from public.account_deletion_requests
   where user_id=p_user_id and status in ('requested','in_progress')
   order by requested_at desc limit 1;
  if not found then
    insert into public.account_deletion_requests(user_id,reauthenticated_at,response_message)
    values(p_user_id,now(),'Your request has been received and is awaiting review.') returning * into r;
    new_request:=true;
  end if;
  if new_request then
    insert into public.account_deletion_request_events(request_id,actor_user_id,from_status,to_status,response_message)
    values(r.id,p_user_id,'none','requested','Account deletion request submitted by the account holder.');
  end if;
  return jsonb_build_object('id',r.id,'status',r.status,'requested_at',r.requested_at,'response_due_at',r.response_due_at);
end; $$;
revoke all on function public.r12_submit_account_deletion_request(uuid) from public, anon, authenticated;
grant execute on function public.r12_submit_account_deletion_request(uuid) to service_role;

create or replace function public.r12_get_own_account_deletion_request()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to view the request' using errcode='42501'; end if;
  select * into r from public.account_deletion_requests where user_id=auth.uid()
   order by requested_at desc limit 1;
  if not found then return jsonb_build_object('status','none'); end if;
  return jsonb_build_object('id',r.id,'status',r.status,'requested_at',r.requested_at,'response_due_at',r.response_due_at,'response_message',r.response_message,'updated_at',r.updated_at,'completed_at',r.completed_at);
end; $$;
revoke all on function public.r12_get_own_account_deletion_request() from public, anon;
grant execute on function public.r12_get_own_account_deletion_request() to authenticated;




create or replace function public.r12_prevent_deletion_event_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  raise exception 'Account deletion audit events are immutable' using errcode='42501';
end; $$;
revoke all on function public.r12_prevent_deletion_event_mutation() from public,anon,authenticated,service_role;
drop trigger if exists account_deletion_request_events_immutable on public.account_deletion_request_events;
create trigger account_deletion_request_events_immutable before update or delete on public.account_deletion_request_events
for each row execute function public.r12_prevent_deletion_event_mutation();

create or replace function public.r12_list_account_deletion_requests()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Account deletion queue is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'user_id',r.user_id,'status',r.status,'requested_at',r.requested_at,
    'response_due_at',r.response_due_at,'response_message',r.response_message,'updated_at',r.updated_at
  ) order by r.requested_at asc) from public.account_deletion_requests r where r.status in ('requested','in_progress')), '[]'::jsonb);
end; $$;
revoke all on function public.r12_list_account_deletion_requests() from public,anon,authenticated;
grant execute on function public.r12_list_account_deletion_requests() to service_role;

create or replace function public.r12_process_account_deletion_request(
  p_request_id uuid,p_operator_id uuid,p_status text,p_response_message text,
  p_retention_reviewed boolean default false,p_eligible_data_processed boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests%rowtype; old_status text;
begin
  if auth.role() is distinct from 'service_role' or p_request_id is null or p_operator_id is null
     or p_status not in ('in_progress','completed','unable_to_complete')
     or p_response_message is null or length(btrim(p_response_message)) not between 1 and 600 then
    raise exception 'Account deletion request update is invalid' using errcode='42501';
  end if;
  select * into r from public.account_deletion_requests where id=p_request_id for update;
  if not found or r.status not in ('requested','in_progress') then raise exception 'Account deletion request is not open' using errcode='22023'; end if;
  if p_status='completed' and (not p_retention_reviewed or not p_eligible_data_processed) then
    raise exception 'Complete the retention review and eligible-data processing before confirmation' using errcode='22023';
  end if;
  old_status:=r.status;
  update public.account_deletion_requests set status=p_status,response_message=btrim(p_response_message),
    updated_at=now(),completed_at=case when p_status='completed' then now() else null end
    where id=p_request_id returning * into r;
  insert into public.account_deletion_request_events(request_id,actor_user_id,from_status,to_status,response_message,retention_reviewed,eligible_data_processed)
  values(r.id,p_operator_id,old_status,p_status,btrim(p_response_message),p_retention_reviewed,p_eligible_data_processed);
  return jsonb_build_object('id',r.id,'status',r.status,'requested_at',r.requested_at,'response_due_at',r.response_due_at,'response_message',r.response_message,'updated_at',r.updated_at,'completed_at',r.completed_at);
end; $$;
revoke all on function public.r12_process_account_deletion_request(uuid,uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.r12_process_account_deletion_request(uuid,uuid,text,text,boolean,boolean) to service_role;

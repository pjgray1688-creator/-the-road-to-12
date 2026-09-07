-- Additive Club finance foundation. This migration stores work and commercial
-- settlement evidence; it is not payroll and does not invent rates or tax rules.
create table if not exists public.club_finance_work_entries (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  staff_user_id uuid not null, work_type text not null check (work_type in ('hours','pt','transformation','class','other')),
  work_date date not null, duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  amount_minor integer check (amount_minor is null or amount_minor >= 0), currency text not null default 'GBP',
  collector text check (collector is null or collector in ('gym','staff','other')), client_customer_id uuid,
  agreement_id uuid, source text not null default 'staff_submitted' check (source in ('staff_submitted','manager_entered','system_derived')),
  status text not null default 'pending_approval' check (status in ('draft','pending_approval','approved','queried','rejected','settled')),
  note text, submitted_at timestamptz not null default now(), approved_by uuid, approved_at timestamptz, manager_note text,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists club_finance_work_period_idx on public.club_finance_work_entries(organisation_id, work_date, status);
create index if not exists club_finance_work_staff_idx on public.club_finance_work_entries(organisation_id, staff_user_id, work_date);

create table if not exists public.club_finance_agreements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null, work_type text not null check (work_type in ('pt','transformation','class','other')),
  rules jsonb not null default '{}'::jsonb, active boolean not null default true, created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists club_finance_agreements_org_idx on public.club_finance_agreements(organisation_id, work_type, active);

create table if not exists public.club_finance_adjustments (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  work_entry_id uuid references public.club_finance_work_entries(id) on delete restrict, amount_minor integer not null, reason text not null,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now()
);

alter table public.club_finance_work_entries enable row level security;
alter table public.club_finance_agreements enable row level security;
alter table public.club_finance_adjustments enable row level security;
revoke all on public.club_finance_work_entries, public.club_finance_agreements, public.club_finance_adjustments from anon, public;

create or replace function public.club_finance_submit_work(p_organisation_id uuid,p_work_type text,p_work_date date,p_duration_minutes integer default null,p_amount_minor integer default null,p_collector text default null,p_note text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_finance_work_entries%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['trainer','gym_staff','gym_admin','owner']) then raise exception 'Finance work submission is not permitted' using errcode='42501'; end if; if p_work_type not in ('hours','pt','transformation','class','other') or (p_duration_minutes is null and p_amount_minor is null) then raise exception 'Invalid work submission' using errcode='22023'; end if; insert into public.club_finance_work_entries(organisation_id,staff_user_id,work_type,work_date,duration_minutes,amount_minor,collector,note) values(p_organisation_id,auth.uid(),p_work_type,p_work_date,p_duration_minutes,p_amount_minor,p_collector,p_note) returning * into r; return to_jsonb(r); end; $$;
revoke all on function public.club_finance_submit_work(uuid,text,date,integer,integer,text,text) from public,anon;
grant execute on function public.club_finance_submit_work(uuid,text,date,integer,integer,text,text) to authenticated;

create or replace function public.club_finance_list_work(p_organisation_id uuid,p_staff_user_id uuid default null) returns setof public.club_finance_work_entries language sql security definer set search_path=pg_catalog,public as $$ select w from public.club_finance_work_entries w where w.organisation_id=p_organisation_id and ((w.staff_user_id=auth.uid() and p_staff_user_id is null) or (p_staff_user_id is not null and p_staff_user_id=auth.uid()) or public.club_has_active_role(p_organisation_id,array['gym_admin','owner'])) order by w.work_date desc,w.created_at desc $$;
revoke all on function public.club_finance_list_work(uuid,uuid) from public,anon;
grant execute on function public.club_finance_list_work(uuid,uuid) to authenticated;

create or replace function public.club_finance_review_work(p_work_id uuid,p_status text,p_manager_note text default null) returns public.club_finance_work_entries language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_finance_work_entries%rowtype; begin select * into r from public.club_finance_work_entries where id=p_work_id for update; if not found or not public.club_has_active_role(r.organisation_id,array['gym_admin','owner']) then raise exception 'Finance review is not permitted' using errcode='42501'; end if; if p_status not in ('approved','queried','rejected','settled') then raise exception 'Invalid finance status' using errcode='22023'; end if; update public.club_finance_work_entries set status=p_status,manager_note=p_manager_note,approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=p_work_id returning * into r; return r; end; $$;
revoke all on function public.club_finance_review_work(uuid,text,text) from public,anon;
grant execute on function public.club_finance_review_work(uuid,text,text) to authenticated;

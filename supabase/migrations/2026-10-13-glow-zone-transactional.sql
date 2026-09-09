-- GLOW ZONE transactional credit lots and retained age verification.
-- Additive, migration-safe; do not apply automatically.
create table if not exists public.club_glow_age_verifications (
  organisation_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  date_of_birth date, status text not null default 'required' check (status in ('required','verified','under_18')),
  verified_at timestamptz, verified_by uuid references auth.users(id) on delete set null, verification_method text,
  primary key (organisation_id,user_id)
);
create table if not exists public.club_service_credit_lots (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid references auth.users(id) on delete set null,
  customer_id uuid, credit_key text not null, unit text not null, original_quantity integer not null check (original_quantity>0),
  remaining_quantity integer not null check (remaining_quantity>=0), granted_at timestamptz not null default now(), expires_at timestamptz,
  source_type text not null check (source_type in ('purchased','promotional','manual_adjustment','reversal_refund')),
  source_reference text, location_id uuid, actor_user_id uuid references auth.users(id) on delete set null, idempotency_key text,
  created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
create table if not exists public.club_service_credit_usage (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid references auth.users(id) on delete set null,
  customer_id uuid, location_id uuid, minutes integer not null check (minutes>0), actor_user_id uuid references auth.users(id),
  idempotency_key text not null, allocations jsonb not null default '[]'::jsonb, qualifying_loyalty boolean not null default false,
  created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
create index if not exists club_service_credit_lots_balance_idx on public.club_service_credit_lots(organisation_id,credit_key,user_id,expires_at);
alter table public.club_glow_age_verifications enable row level security; alter table public.club_service_credit_lots enable row level security; alter table public.club_service_credit_usage enable row level security;
drop policy if exists glow_age_self_staff on public.club_glow_age_verifications; create policy glow_age_self_staff on public.club_glow_age_verifications for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_lots_self_staff on public.club_service_credit_lots; create policy glow_lots_self_staff on public.club_service_credit_lots for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_usage_self_staff on public.club_service_credit_usage; create policy glow_usage_self_staff on public.club_service_credit_usage for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_glow_age_verifications%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Age verification is not permitted' using errcode='42501'; end if; insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method) values(p_organisation_id,p_user_id,p_date_of_birth,case when p_date_of_birth <= (current_date - interval '18 years')::date then 'verified' else 'under_18' end,case when p_date_of_birth <= (current_date - interval '18 years')::date then now() end,case when p_date_of_birth <= (current_date - interval '18 years')::date then auth.uid() end,p_method) on conflict (organisation_id,user_id) do update set date_of_birth=excluded.date_of_birth,status=excluded.status,verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method returning * into r; return to_jsonb(r); end; $$;
revoke all on function public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon,authenticated; grant execute on function public.club_glow_record_age_verification(uuid,uuid,date,text) to authenticated;

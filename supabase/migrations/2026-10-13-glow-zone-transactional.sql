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
-- Bridge the existing canonical service-credit grant path into expiry lots. Legacy net balances
-- are represented once as non-expiring compatibility lots; new positive grants get a 3-month lot.
insert into public.club_service_credit_lots(organisation_id,user_id,customer_id,credit_key,unit,original_quantity,remaining_quantity,source_type,source_reference,actor_user_id,idempotency_key)
select a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit,greatest(sum(e.quantity_delta),0),greatest(sum(e.quantity_delta),0),'manual_adjustment','legacy_service_credit_balance',null,'legacy:'||a.id::text
from public.club_service_credit_accounts a join public.club_service_credit_entries e on e.account_id=a.id
where a.credit_key='sunbed_minutes' group by a.id,a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit having sum(e.quantity_delta)>0
on conflict (organisation_id,idempotency_key) do nothing;
create or replace function public.club_service_credit_lot_bridge() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.quantity_delta>0 and exists(select 1 from public.club_service_credit_accounts a where a.id=new.account_id and a.credit_key='sunbed_minutes') then
  insert into public.club_service_credit_lots(organisation_id,user_id,customer_id,credit_key,unit,original_quantity,remaining_quantity,granted_at,expires_at,source_type,source_reference,actor_user_id,idempotency_key)
  select a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit,new.quantity_delta,new.quantity_delta,new.occurred_at,new.occurred_at+interval '3 months',case when new.entry_type='promotion_grant' then 'promotional' when new.entry_type='purchase_grant' then 'purchased' else 'manual_adjustment' end,new.id::text,new.actor_user_id,'entry:'||new.id::text from public.club_service_credit_accounts a where a.id=new.account_id on conflict (organisation_id,idempotency_key) do nothing;
 end if; return new;
end; $$;
drop trigger if exists club_service_credit_lot_bridge on public.club_service_credit_entries;
create trigger club_service_credit_lot_bridge after insert on public.club_service_credit_entries for each row execute function public.club_service_credit_lot_bridge();
alter table public.club_glow_age_verifications enable row level security; alter table public.club_service_credit_lots enable row level security; alter table public.club_service_credit_usage enable row level security;
drop policy if exists glow_age_self_staff on public.club_glow_age_verifications; create policy glow_age_self_staff on public.club_glow_age_verifications for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_lots_self_staff on public.club_service_credit_lots; create policy glow_lots_self_staff on public.club_service_credit_lots for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_usage_self_staff on public.club_service_credit_usage; create policy glow_usage_self_staff on public.club_service_credit_usage for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_glow_age_verifications%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Age verification is not permitted' using errcode='42501'; end if; insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method) values(p_organisation_id,p_user_id,p_date_of_birth,case when p_date_of_birth <= (current_date - interval '18 years')::date then 'verified' else 'under_18' end,case when p_date_of_birth <= (current_date - interval '18 years')::date then now() end,case when p_date_of_birth <= (current_date - interval '18 years')::date then auth.uid() end,p_method) on conflict (organisation_id,user_id) do update set date_of_birth=excluded.date_of_birth,status=excluded.status,verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method returning * into r; return to_jsonb(r); end; $$;
revoke all on function public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon,authenticated; grant execute on function public.club_glow_record_age_verification(uuid,uuid,date,text) to authenticated;

create or replace function public.club_glow_balance(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select case when auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then jsonb_build_object('minutes',coalesce(sum(remaining_quantity) filter(where expires_at is null or expires_at>now()),0),'next_expiry',min(expires_at) filter(where remaining_quantity>0 and expires_at>now())) else jsonb_build_object('minutes',0,'next_expiry',null) end from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes'; $$;
create or replace function public.club_glow_spend(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; u public.club_service_credit_usage%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb; adult boolean;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_minutes<=0 then raise exception 'Glow Zone usage is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 if exists(select 1 from public.club_service_credit_usage where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then select to_jsonb(u) into v from public.club_service_credit_usage u where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; return v; end if;
 select status='verified' and date_of_birth <= (current_date - interval '18 years')::date into adult from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id; if not coalesce(adult,false) then raise exception 'Glow Zone age verification required' using errcode='42501'; end if;
 for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop exit when left_qty=0; take:=least(left_qty,l.remaining_quantity); update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id; alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take; end loop;
 if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
 insert into public.club_service_credit_usage(organisation_id,user_id,location_id,minutes,actor_user_id,idempotency_key,allocations,qualifying_loyalty) values(p_organisation_id,p_user_id,p_location_id,p_minutes,auth.uid(),p_idempotency_key,alloc,p_minutes>=5) returning * into u; return to_jsonb(u);
end; $$;
revoke all on function public.club_glow_balance(uuid,uuid),public.club_glow_spend(uuid,uuid,uuid,integer,text) from public,anon,authenticated; grant execute on function public.club_glow_balance(uuid,uuid) to authenticated; grant execute on function public.club_glow_spend(uuid,uuid,uuid,integer,text) to authenticated;

create or replace function public.club_glow_grant_manual(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_lot public.club_service_credit_lots%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_minutes<=0 or nullif(trim(p_reason),'') is null then raise exception 'Glow Zone adjustment is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 if exists(select 1 from public.club_service_credit_lots where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then select * into v_lot from public.club_service_credit_lots where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; return to_jsonb(v_lot); end if;
 insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
 values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','manual_adjustment',p_reason,p_location_id,auth.uid(),p_idempotency_key) returning * into v_lot;
 return to_jsonb(v_lot);
end; $$;
revoke all on function public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text) to authenticated;

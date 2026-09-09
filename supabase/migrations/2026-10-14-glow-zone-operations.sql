-- Additive follow-up for the already-installed Glow Zone transaction contract.
create table if not exists public.club_glow_adjustments (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid not null,
 location_id uuid not null, minutes integer not null check (minutes>0), direction text not null check (direction in ('add','remove')),
 reason text not null, actor_user_id uuid not null references auth.users(id), allocations jsonb not null default '[]'::jsonb,
 idempotency_key text not null, created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
alter table public.club_glow_adjustments enable row level security;
drop policy if exists glow_adjustments_self_staff on public.club_glow_adjustments;
create policy glow_adjustments_self_staff on public.club_glow_adjustments for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_adjust_remove(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_glow_adjustments%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or p_minutes<=0 or nullif(trim(p_reason),'') is null then raise exception 'Glow Zone removal is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 select * into a from public.club_glow_adjustments where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(a); end if;
 for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop exit when left_qty=0; take:=least(left_qty,l.remaining_quantity); update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id; alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take; end loop;
 if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
 insert into public.club_glow_adjustments(organisation_id,user_id,location_id,minutes,direction,reason,actor_user_id,allocations,idempotency_key) values(p_organisation_id,p_user_id,p_location_id,p_minutes,'remove',trim(p_reason),auth.uid(),alloc,p_idempotency_key) returning * into a; return to_jsonb(a);
end; $$;
revoke all on function public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text) to authenticated;

create or replace function public.club_glow_history(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(x order by created_at desc),'[]'::jsonb) from (
  select jsonb_build_object('kind','credit','minutes',original_quantity,'remaining',remaining_quantity,'source',source_type,'reason',source_reference,'expires_at',expires_at,'location_id',location_id,'created_at',created_at) as x, created_at from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id
  union all select jsonb_build_object('kind','usage','minutes',-minutes,'source','usage','created_at',created_at,'location_id',location_id,'qualifying_loyalty',qualifying_loyalty) as x,created_at from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id
  union all select jsonb_build_object('kind','adjustment','minutes',case when direction='add' then minutes else -minutes end,'source','manual_adjustment','reason',reason,'created_at',created_at,'location_id',location_id) as x,created_at from public.club_glow_adjustments where organisation_id=p_organisation_id and user_id=p_user_id
 ) x where auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']); $$;
revoke all on function public.club_glow_history(uuid,uuid) from public,anon,authenticated; grant execute on function public.club_glow_history(uuid,uuid) to authenticated;

create or replace function public.club_glow_loyalty(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('qualifying_sessions',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0),'threshold',9,'reward_earned',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0)>=9) from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id and (auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])); $$;
revoke all on function public.club_glow_loyalty(uuid,uuid) from public,anon,authenticated; grant execute on function public.club_glow_loyalty(uuid,uuid) to authenticated;

-- Staff-confirmed reception tender and atomic purchased-minute fulfilment.
create table if not exists public.club_glow_sales (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, user_id uuid not null,
 package_id text not null, minutes integer not null check (minutes>0), amount_minor integer not null check (amount_minor>0),
 tender_type text not null check (tender_type in ('cash','external_card')), tender_confirmed_at timestamptz not null default now(),
 actor_user_id uuid not null references auth.users(id), seller_name text not null default 'MADHOUSE PRODUCTS AND SERVICES LIMITED', seller_company_number text not null default '17383213',
 idempotency_key text not null, status text not null default 'completed' check (status='completed'), created_at timestamptz not null default now(), unique(organisation_id,idempotency_key)
);
alter table public.club_glow_sales enable row level security;
drop policy if exists glow_sales_self_staff on public.club_glow_sales;
create policy glow_sales_self_staff on public.club_glow_sales for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_complete_sale(p_organisation_id uuid,p_location_id uuid,p_user_id uuid,p_package_id text,p_minutes integer,p_tender_type text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_glow_sales%rowtype; price integer; age_ok boolean;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Sale not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 select * into s from public.club_glow_sales where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(s); end if;
 if p_package_id='member-30' then price:=1000; if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then raise exception 'Member package requires active membership' using errcode='42501'; end if;
 elsif p_package_id='member-100' then price:=3000; if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then raise exception 'Member package requires active membership' using errcode='42501'; end if;
 elsif p_package_id='quick-30' then price:=1800; elsif p_package_id='bronze-60' then price:=3000; elsif p_package_id='full-100' then price:=5000; elsif p_package_id='payg' then price:=p_minutes*100; else raise exception 'Unknown Glow Zone package' using errcode='22023'; end if;
 if p_minutes<=0 or (p_package_id<>'payg' and ((p_package_id like '%30' and p_minutes<>30) or (p_package_id like '%60' and p_minutes<>60) or (p_package_id like '%100' and p_minutes<>100))) then raise exception 'Invalid Glow Zone quantity' using errcode='22023'; end if;
 insert into public.club_glow_sales(organisation_id,location_id,user_id,package_id,minutes,amount_minor,tender_type,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_user_id,p_package_id,p_minutes,price,p_tender_type,auth.uid(),p_idempotency_key) returning * into s;
 insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key) values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','purchased',s.id::text,p_location_id,auth.uid(),'sale:'||s.id::text);
 return to_jsonb(s);
end; $$;
revoke all on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) to authenticated;

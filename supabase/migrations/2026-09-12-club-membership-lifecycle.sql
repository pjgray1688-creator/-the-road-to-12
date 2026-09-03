-- Guest-capable membership lifecycle. Manual review only; never execute from the app.
alter table public.club_membership_holders add column if not exists id uuid default gen_random_uuid();
alter table public.club_membership_holders add column if not exists organisation_id uuid;
alter table public.club_membership_holders alter column user_id drop not null;
alter table public.club_membership_holders add column if not exists customer_id uuid;
update public.club_membership_holders h set organisation_id = m.organisation_id from public.club_memberships m where m.id = h.membership_id and h.organisation_id is null;
update public.club_membership_holders set id = gen_random_uuid() where id is null;
alter table public.club_membership_holders alter column organisation_id set not null;
alter table public.club_membership_holders drop constraint if exists club_membership_holders_pkey;
alter table public.club_membership_holders add constraint club_membership_holders_pkey primary key (id);
alter table public.club_membership_holders add constraint club_membership_holders_identity_chk check (num_nonnulls(user_id, customer_id) = 1);
alter table public.club_membership_holders add constraint club_membership_holders_membership_org_fk foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete cascade;
alter table public.club_membership_holders add constraint club_membership_holders_customer_org_fk foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete cascade;
create unique index if not exists club_membership_holders_user_uq on public.club_membership_holders(membership_id, user_id) where user_id is not null;
create unique index if not exists club_membership_holders_customer_uq on public.club_membership_holders(membership_id, customer_id) where customer_id is not null;
alter table public.club_memberships add column if not exists assignment_idempotency_key text;
alter table public.club_memberships add column if not exists ended_at timestamptz;
alter table public.club_memberships add column if not exists ended_by uuid references auth.users(id);
alter table public.club_memberships add column if not exists end_reason text;
create unique index if not exists club_memberships_assignment_key_uq on public.club_memberships(organisation_id, assignment_idempotency_key) where assignment_idempotency_key is not null;

create or replace function public.club_assign_membership(p_organisation_id uuid, p_product_id uuid, p_customer_id uuid, p_holder_user_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz, p_source text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_product public.club_products%rowtype; v_membership public.club_memberships%rowtype; v_users uuid[]; v_existing public.club_memberships%rowtype; v_holders jsonb; v_grants jsonb;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Membership assignment is not permitted' using errcode='42501'; end if;
 select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
 if not found or v_product.archived_at is not null or v_product.kind <> 'membership' then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
 if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) or nullif(trim(p_idempotency_key),'') is null then raise exception 'Invalid membership assignment' using errcode='22023'; end if;
 if p_customer_id is null and coalesce(cardinality(p_holder_user_ids),0)=0 then raise exception 'At least one holder is required' using errcode='22023'; end if;
 if p_customer_id is not null and not exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=p_organisation_id) then raise exception 'Customer is not in this organisation' using errcode='42501'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into v_users from unnest(coalesce(p_holder_user_ids,'{}')) x;
 if exists(select 1 from unnest(v_users) x where not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=x and m.active)) then raise exception 'Every holder must be an active organisation member' using errcode='22023'; end if;
 select * into v_existing from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key=p_idempotency_key for update;
 if found then
   if v_existing.product_id<>p_product_id or v_existing.starts_at<>p_starts_at or v_existing.ends_at is distinct from p_ends_at or v_existing.source<>p_source or exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null and not (h.user_id=any(v_users))) or (select count(*) from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null)<>cardinality(v_users) then raise exception 'Membership assignment idempotency conflict' using errcode='23505'; end if;
   select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_existing.id;
   select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_existing.id;
   return jsonb_build_object('membership',to_jsonb(v_existing),'holders',v_holders,'grants',v_grants);
 end if;
 insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key) values(p_organisation_id,p_product_id,'active',p_starts_at,p_ends_at,p_source,p_idempotency_key) returning * into v_membership;
 if p_customer_id is not null then insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id) values(gen_random_uuid(),v_membership.id,p_organisation_id,p_customer_id); end if;
 insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) select gen_random_uuid(),v_membership.id,p_organisation_id,x from unnest(v_users) x;
 insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
 select u,v_membership.organisation_id,v_membership.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,v_membership.starts_at,v_membership.ends_at,v_membership.source from unnest(v_users) u join public.club_product_entitlements e on e.product_id=v_product.id;
 select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_membership.id; select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_membership.id;
 return jsonb_build_object('membership',to_jsonb(v_membership),'holders',v_holders,'grants',v_grants);
end; $$;

create or replace function public.club_link_customer_user(p_customer_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog, public as $$
declare c public.club_customers%rowtype; h record; e public.club_product_entitlements%rowtype;
begin
 select * into c from public.club_customers where id=p_customer_id for update; if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
 if auth.uid() is null or not public.club_has_active_role(c.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer linking is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members m where m.organisation_id=c.organisation_id and m.user_id=p_user_id and m.active) then raise exception 'User is not an active organisation member' using errcode='42501'; end if;
 if c.user_id is not null and c.user_id<>p_user_id then raise exception 'Customer is already linked' using errcode='23505'; end if;
 update public.club_customers set user_id=p_user_id,updated_at=now() where id=c.id returning * into c;
 for h in select m.*, p.id product_id from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where h.customer_id=c.id loop
   update public.club_membership_holders set user_id=p_user_id,customer_id=null where membership_id=h.id and customer_id=c.id;
   insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source) select p_user_id,h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=p_user_id and g.entitlement_key=e.entitlement_key);
 end loop; return to_jsonb(c);
end; $$;

create or replace function public.club_end_membership(p_organisation_id uuid,p_membership_id uuid,p_effective_at timestamptz,p_status text,p_reason text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog, public as $$
declare m public.club_memberships%rowtype; at timestamptz:=coalesce(p_effective_at,now());
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Membership ending is not permitted' using errcode='42501'; end if;
 select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update; if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
 if p_status not in ('cancelled','expired') then raise exception 'Invalid membership end status' using errcode='22023'; end if;
 if m.ends_at is not null and m.ends_at<=at then return to_jsonb(m); end if;
 update public.club_memberships set ends_at=at, status=case when at<=now() then p_status else status end, ended_at=case when at<=now() then now() else ended_at end, ended_by=case when at<=now() then auth.uid() else ended_by end, end_reason=coalesce(p_reason,end_reason) where id=m.id returning * into m; return to_jsonb(m);
end; $$;

revoke all on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.club_link_customer_user(uuid,uuid) from public,anon;
revoke all on function public.club_end_membership(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.club_link_customer_user(uuid,uuid) to authenticated;
grant execute on function public.club_end_membership(uuid,uuid,timestamptz,text,text) to authenticated;

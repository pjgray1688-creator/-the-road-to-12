-- Member joining boundary. Organisations opt in explicitly; no memberships are
-- activated here because payment/provider confirmation remains a separate step.
alter table public.club_organisations add column if not exists member_joinable boolean not null default false;

create table if not exists public.club_membership_join_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  product_id uuid not null,
  status text not null default 'payment_required' check (status in ('details_recorded','payment_required','staff_review','completed','cancelled')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id, idempotency_key),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete restrict,
  foreign key (product_id, organisation_id) references public.club_products(id, organisation_id) on delete restrict
);
create index if not exists club_join_requests_user_idx on public.club_membership_join_requests(organisation_id,user_id,created_at desc);
alter table public.club_membership_join_requests enable row level security;
revoke all on table public.club_membership_join_requests from public, anon, authenticated;
grant select on table public.club_membership_join_requests to authenticated;
create policy club_join_requests_subject_select on public.club_membership_join_requests for select to authenticated using (user_id=auth.uid());

create or replace function public.club_list_joinable_organisations()
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',id,'name',name,'slug',slug,'active',active,'branding',branding)
  from public.club_organisations
  where active and member_joinable
  order by name;
$$;

create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'sellable',p.sellable)
  from public.club_products p
  join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
  order by p.name;
$$;

create or replace function public.club_start_membership_joining(p_organisation_id uuid,p_product_id uuid,p_display_name text,p_email text,p_phone text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_customer public.club_customers%rowtype; v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_display_name),'') is null then raise exception 'Joining details are incomplete' using errcode='22023'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active and member_joinable) then raise exception 'Joining is not available for this organisation' using errcode='42501'; end if;
  select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id and kind='membership' and sellable and archived_at is null;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if p_email is not null and exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(email)=lower(btrim(p_email)) and user_id is null) then
      raise exception 'An existing membership record may match these details; staff review is required' using errcode='23505';
    end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(p_organisation_id,v_user,btrim(p_display_name),nullif(btrim(p_email),''),nullif(btrim(p_phone),''),'customer') returning * into v_customer;
  else
    update public.club_customers set display_name=btrim(p_display_name),email=coalesce(nullif(btrim(p_email),''),email),phone=coalesce(nullif(btrim(p_phone),''),phone),updated_at=now() where id=v_customer.id returning * into v_customer;
  end if;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and idempotency_key=p_idempotency_key for update;
  if found then return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product)); end if;
  insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,status,idempotency_key) values(p_organisation_id,v_user,v_customer.id,v_product.id,'payment_required',btrim(p_idempotency_key)) returning * into v_request;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;

revoke all on function public.club_list_joinable_organisations() from public,anon;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon;
revoke all on function public.club_start_membership_joining(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.club_list_joinable_organisations() to authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to authenticated;
grant execute on function public.club_start_membership_joining(uuid,uuid,text,text,text,text) to authenticated;

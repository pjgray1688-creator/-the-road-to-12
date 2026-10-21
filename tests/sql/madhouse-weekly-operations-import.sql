begin;
do $$
declare org uuid:='fa44592a-1593-4ad3-a621-63a4a4bcbceb'; result jsonb;
begin
  if (select count(*) from public.club_madhouse_class_templates where organisation_id=org and active)<>6 then raise exception 'Expected six Madhouse class templates'; end if;
  if exists(select 1 from public.club_madhouse_class_templates where organisation_id=org and (capacity<>6 or transformation_credit_limit<>2 or duration_minutes is not null or effective_from is not null or time_zone<>'Europe/London')) then raise exception 'Madhouse class template defaults are unsafe'; end if;
  if (select count(*) from public.club_madhouse_rota_templates where organisation_id=org and active)<>14 then raise exception 'Expected complete 14-shift weekly rota templates'; end if;
  if not exists(select 1 from public.club_madhouse_rota_templates where organisation_id=org and template_key='friday-carlton-shannon' and staff_name='Shannon' and starts_local='09:00' and ends_local='20:00') then raise exception 'Canonical Shannon Friday shift missing'; end if;
  if exists(select 1 from public.club_madhouse_rota_templates where organisation_id=org and (effective_from is not null or time_zone<>'Europe/London')) then raise exception 'Rota templates must remain undated local-time rules'; end if;
  if (select count(*) from public.club_location_service_hours where organisation_id=org and service_key='sunbeds')<>7 then raise exception 'Expected seven Glow Zone weekday records'; end if;
  if not exists(select 1 from public.club_location_service_hours where organisation_id=org and weekday=7 and confirmation_state='confirmed_closed' and opens_local is null and closes_local is null) then raise exception 'Sunday closure must be confirmed'; end if;
  if not exists(select 1 from public.club_location_service_hours where organisation_id=org and weekday=1 and opens_local='14:00' and closes_local='20:00')
    or not exists(select 1 from public.club_location_service_hours where organisation_id=org and weekday=4 and opens_local='09:00' and closes_local='20:00')
    or not exists(select 1 from public.club_location_service_hours where organisation_id=org and weekday=6 and opens_local='10:00' and closes_local='13:00') then raise exception 'Glow Zone weekday hours do not match the confirmed schedule'; end if;
  if (select payg_price_minor from public.club_madhouse_class_commercial_config where organisation_id=org)<>1000 then raise exception 'PAYG class price must be £10 GBP'; end if;
  if (select monthly_addon_active from public.club_madhouse_class_commercial_config where organisation_id=org) is distinct from false then raise exception 'Monthly add-on must remain inactive'; end if;
  if not exists(select 1 from pg_trigger where tgname='club_madhouse_class_capacity' and not tgisinternal) then raise exception 'Serialized capacity trigger is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='club_madhouse_class_session_limit' and not tgisinternal) then raise exception 'Session cap trigger is missing'; end if;
  if to_regprocedure('public.club_redeem_transformation_class_credit(uuid)') is null then raise exception 'Future-week transformation credit redemption is missing'; end if;
  if to_regprocedure('public.club_redeem_reusable_class_credit(uuid)') is null then raise exception 'Reusable class credit redemption is missing'; end if;
  if to_regprocedure('public.club_madhouse_generate_class_sessions(uuid,date,date)') is null then raise exception 'Future class session generator is missing'; end if;
  if to_regprocedure('public.club_madhouse_generate_rota(uuid,date,date)') is null then raise exception 'Existing Club rota generator is missing'; end if;
  if to_regprocedure('public.club_madhouse_seed_daily_checks(uuid)') is null then raise exception 'Existing Club daily check import is missing'; end if;
  if to_regprocedure('public.club_start_member_payg_class_booking(uuid,text,text)') is null then raise exception 'Member PAYG booking path is missing'; end if;
  if to_regprocedure('public.club_record_class_stripe_event(text,text,uuid,uuid,text,text,integer,text,boolean,timestamptz)') is null then raise exception 'Verified class Stripe webhook path is missing'; end if;
  if to_regprocedure('public.club_record_class_cash_dropbox(uuid,text,text)') is null then raise exception 'Drop-box cash reconciliation path is missing'; end if;
  if to_regprocedure('public.club_staff_collect_class_cash(uuid,uuid,uuid)') is null then raise exception 'Staff cash collection path is missing'; end if;
  if to_regprocedure('public.club_get_host_class_register(uuid)') is null then raise exception 'Host class register is missing'; end if;
  if to_regprocedure('public.club_staff_list_class_members(uuid)') is null then raise exception 'Staff member selection for cash booking is missing'; end if;
  if has_function_privilege('anon','public.club_redeem_transformation_class_credit(uuid)','execute') then raise exception 'Anonymous caller can redeem included class credit'; end if;
end $$;
rollback;

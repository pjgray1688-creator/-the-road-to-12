-- Correct the cash top-up contract: declaration and ledger credit are one
-- idempotent transaction, and replay returns the existing credit.
create or replace function public.club_record_balance_cash_top_up(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text,p_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; existing public.club_balance_entries%rowtype; b integer;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Cash top-up is not permitted' using errcode='42501'; end if;
 if p_amount_minor<=0 or p_customer_id is null or p_location_id is null or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Invalid balance top-up' using errcode='22023'; end if;
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share; if not found then raise exception 'Member not found' using errcode='P0002'; end if;
 select * into existing from public.club_balance_entries where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(existing); end if;
 select * into a from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
 if not found then insert into public.club_balance_accounts(organisation_id,customer_id,user_id,currency) values(p_organisation_id,p_customer_id,c.user_id,p_currency) returning * into a; end if;
 if a.currency<>p_currency or a.status<>'active' then raise exception 'Balance account is unavailable' using errcode='22023'; end if;
 insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,declared_amount_minor,currency,status,confirmed_at,confirmed_by,notes,idempotency_key) values(p_organisation_id,p_location_id,'balance_top_up',c.user_id,p_customer_id,p_amount_minor,p_currency,'confirmed',now(),auth.uid(),p_notes,p_idempotency_key);
 b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0);
 insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,actor_user_id,reason,idempotency_key) values(a.id,p_organisation_id,'top_up',p_amount_minor,b+p_amount_minor,auth.uid(),coalesce(p_notes,'Cash top-up'),p_idempotency_key) returning * into e;
 return to_jsonb(e);
end; $$;
revoke all on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) from public,anon;
grant execute on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) to authenticated;

-- Reclaim abandoned notification delivery leases without changing the outbox model.
-- Keep MAX_ATTEMPTS aligned with lib/notification-worker.ts.
create or replace function public.club_claim_notification_intents(p_limit integer,p_worker_id text)
returns setof public.club_member_notification_intents language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;

  -- Expired leases are recovered atomically. A healthy worker's unexpired lease
  -- is untouched. Attempts count claims, so an abandoned final attempt is terminal.
  update public.club_member_notification_intents
  set state=case when attempts>=3 then 'failed' else 'scheduled' end,
      not_before=case when attempts>=3 then not_before else now() end,
      failure_code=case when attempts>=3 then 'claim_lease_expired_max_attempts' else 'claim_lease_expired' end,
      failure_message=case when attempts>=3 then 'Delivery claim expired after the maximum attempts; manual review is required.' else 'Delivery claim expired before completion; the notification was safely rescheduled.' end,
      claimed_by=null,claimed_until=null,updated_at=now()
  where state='processing' and (claimed_until is null or claimed_until<=now());

  return query
    with candidates as (
      select id from public.club_member_notification_intents
      where target_email is not null and state in ('pending','scheduled')
        and attempts<3 and not_before<=now()
      order by not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
    )
    update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,
      last_attempt_at=now(),claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents(integer,text) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents(integer,text) to service_role;

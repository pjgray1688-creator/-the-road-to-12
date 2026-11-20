import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveMemberInvitationToken, hashMemberInvitationToken, verifyMemberInvitationToken } from "../lib/madhouse-member-invitation-token";
import { renderNotification } from "../lib/notification-templates";

const migration = readFileSync(new URL("../supabase/migrations/2027-02-12-madhouse-member-self-service-activation-invitations.sql", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/club/members/activation/actions.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../app/api/internal/notification-worker/route.ts", import.meta.url), "utf8");
const claim = readFileSync(new URL("../supabase/migrations/2026-11-19-club-auto-link-verified-imported-members.sql", import.meta.url), "utf8");
const access = readFileSync(new URL("../supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", import.meta.url), "utf8");

const invitationId = "d7d19286-9eec-4bb5-b7bf-1df5df2ebc09";
const secret = "a-long-random-server-only-secret-with-more-than-thirty-two-bytes";

test("valid verified-email activation calls the existing exact-customer claim atomically", () => {
  const redeem = migration.slice(migration.indexOf("create or replace function public.club_redeem_madhouse_member_activation_invitation"), migration.indexOf("-- Keep the old worker signature"));
  assert.match(redeem, /email_confirmed_at/);
  assert.match(redeem, /i\.invited_email is distinct from v_email/);
  assert.match(redeem, /i\.token_hash is distinct from lower\(p_token_hash\)/);
  assert.match(redeem, /perform public\.club_claim_existing_member\(i\.organisation_id,c\.id\)/);
  assert.match(redeem, /status='redeemed',redeemed_by=auth\.uid\(\),redeemed_at=now\(\)/);
  assert.match(claim, /update public\.club_membership_holders set user_id=auth\.uid\(\),customer_id=null/);
  assert.match(claim, /insert into public\.club_entitlement_grants/);
  assert.match(access, /create trigger club_holder_access_projection_refresh after insert or update or delete on public\.club_membership_holders[\s\S]*club_ensure_person_access_credentials/);
  assert.doesNotMatch(redeem, /insert into public\.club_memberships|insert into public\.club_customers|mandate|subscription/i);
});

test("wrong email, token replay, expiry and already-linked conflicts fail safely", () => {
  const redeem = migration.slice(migration.indexOf("create or replace function public.club_redeem_madhouse_member_activation_invitation"), migration.indexOf("-- Keep the old worker signature"));
  assert.match(redeem, /i\.status not in \('queued','sent'\) or i\.expires_at<=now\(\)/);
  assert.match(redeem, /i\.status='redeemed' and i\.redeemed_by=auth\.uid\(\).*already_linked/s);
  assert.match(redeem, /i\.status not in \('queued','sent'\)/);
  assert.match(redeem, /elsif c\.user_id is not null then[\s\S]*status='exception'/);
  assert.match(redeem, /if c\.user_id=auth\.uid\(\) then[\s\S]*status='redeemed'/);
  assert.match(redeem, /when unique_violation or insufficient_privilege/);
  assert.match(migration, /unique index if not exists club_madhouse_member_activation_one_open_invite/);
  assert.match(migration, /case when invite_status='redeemed' then 'completed'[\s\S]*when user_id is not null then 'already_linked'/);
});

test("shared household emails and ambiguous identities stay in staff review", () => {
  const classifier = migration.slice(migration.indexOf("create or replace function public.club_madhouse_member_activation_candidate_state"), migration.indexOf("create or replace function public.club_preview_madhouse_member_activation_invitations"));
  assert.match(classifier, /club_imported_member_email_is_ambiguous/);
  assert.match(classifier, /count\(\*\).*club_customers/s);
  assert.match(classifier, /shared_or_ambiguous_email/);
  assert.match(classifier, /account_link_conflict/);
  assert.match(migration, /'shared_or_placeholder'/);
  assert.match(migration, /'exception'/);
});

test("only active Madhouse gym holders can be included; expired or historical memberships cannot", () => {
  const classifier = migration.slice(migration.indexOf("create or replace function public.club_madhouse_member_activation_candidate_state"), migration.indexOf("create or replace function public.club_preview_madhouse_member_activation_invitations"));
  assert.match(classifier, /organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'/);
  assert.match(classifier, /m\.status='active' and m\.starts_at<=now\(\) and \(m\.ends_at is null or m\.ends_at>now\(\)\)/);
  assert.match(classifier, /pe\.entitlement_key='gym_access'/);
  assert.match(classifier, /h\.customer_id=c\.id/);
  assert.match(classifier, /not_active/);
});

test("preview and queue/redeem RPCs enforce management or authenticated user access with tenant isolation", () => {
  for (const functionName of ["club_preview_madhouse_member_activation_invitations", "club_queue_madhouse_member_activation_invitations"]) {
    const start = migration.indexOf(`create or replace function public.${functionName}`);
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    assert.match(body, /p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'/);
    assert.match(body, /role in \('owner','gym_admin'\)/);
    assert.match(body, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.link_account'\)/);
  }
  assert.match(migration, /grant execute on function public\.club_redeem_madhouse_member_activation_invitation\(uuid,text\) to authenticated/);
  assert.match(migration, /grant execute on function public\.club_get_madhouse_member_activation_delivery_context\(uuid\) to service_role/);
  assert.match(migration, /if auth\.role\(\)<>'service_role' then raise exception 'Service access required'/);
  assert.match(migration, /revoke all on public\.club_madhouse_member_activation_invitations from public,anon,authenticated/);
});

test("hash-only tokens are single-invitation bound; outbox has explicit delivery gates and bounded retry batches", () => {
  const token = deriveMemberInvitationToken(invitationId, secret);
  const hash = hashMemberInvitationToken(token);
  assert.equal(verifyMemberInvitationToken(invitationId, secret, hash), true);
  assert.equal(verifyMemberInvitationToken(invitationId, secret, token), false);
  assert.match(migration, /token_hash text not null check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /values\(v_id,p_organisation_id,v_customer\.id,v_email,v_hash,'queued',now\(\)\+interval '7 days',auth\.uid\(\)\)/);
  assert.match(migration, /v_recent\+jsonb_array_length\(p_entries\)>250/);
  assert.match(migration, /and template_key<>'madhouse_member_invitation'/);
  assert.match(migration, /p_include_madhouse_member_invitations boolean/);
  assert.match(migration, /select id,id customer_id,display_name/);
  assert.match(migration, /jsonb_build_object\('invitationId',v_id,'name',v_name,'organisationName',v_org_name\)/);
  assert.doesNotMatch(migration, /jsonb_build_object\([^;]*(?:tokenHash|rawToken|activationUrl)/);
  assert.match(migration, /create trigger club_sync_madhouse_member_invitation_delivery_state[\s\S]*after update of state/);
  assert.match(migration, /set status='expired',updated_at=now\(\) where id=i\.id/);
  assert.match(migration, /set status='exception',failure_code='identity_changed'/);
  assert.match(worker, /R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED/);
  assert.match(worker, /p_include_madhouse_member_invitations: includeMadhouseInvitations/);
  assert.match(worker, /club_get_madhouse_member_activation_delivery_context/);
});

test("management sending requires explicit confirmation and worker configuration; member flow keeps Glow verification separate", () => {
  assert.match(actions, /\["owner", "gym_admin"\]/);
  assert.match(actions, /R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED/);
  assert.match(actions, /notificationTransportAvailable\(\)/);
  assert.match(actions, /nudgeNotificationWorker\(\)/);
  const rendered = renderNotification({ templateKey: "madhouse_member_invitation", payload: {
    name: "Alex Member", maskedEmail: "p••••@gmail.com", activationUrl: `https://app.r12.live/member-hub/activate?invitation=${invitationId}#token=${deriveMemberInvitationToken(invitationId, secret)}`,
  } });
  assert.equal(rendered.cta, "ACTIVATE YOUR R12 ACCOUNT");
  assert.equal(rendered.senderName, "Madhouse Gym");
  assert.deepEqual(rendered.replyTo, { name: "Madhouse Gym", address: "contact@madhousegym.online" });
  assert.match(rendered.text, /Hi Alex Member/);
  assert.match(rendered.html, /Hi Alex Member/);
  assert.match(rendered.text, /single-use invitation link expires seven days/i);
  assert.match(rendered.html, /single-use invitation link expires seven days/i);
  assert.match(rendered.html, /max-width:600px/);
  assert.match(rendered.html, /madhouse-club-wide\.png/);
  assert.match(rendered.text, /existing membership will be retained/);
  assert.match(rendered.text, /There is no payment/);
  assert.match(rendered.text, /p••••@gmail\.com/);
  assert.doesNotMatch(rendered.text, /Glow Zone identity verification/);
});

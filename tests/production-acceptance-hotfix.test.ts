import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchesClubMemberDirectoryFilters, type ClubDirectoryRow } from "@/lib/club-member-directory";

const filters = { query: "", status: "all", access: "all", home: "all", plan: "all", arrearsUserIds: new Set<string>() };

test("member access filters keep membership, linked identity, credential and eligibility separate", () => {
  const imported: ClubDirectoryRow = {
    displayName: "Imported current member", ref: "MAD001", imported: true,
    membershipActive: true, r12Linked: false, credentialIssued: false, accessEligible: false,
  };
  assert.equal(matchesClubMemberDirectoryFilters(imported, { ...filters, access: "active_membership" }), true);
  assert.equal(matchesClubMemberDirectoryFilters(imported, { ...filters, access: "linked" }), false);
  assert.equal(matchesClubMemberDirectoryFilters(imported, { ...filters, access: "credential_issued" }), false);
  assert.equal(matchesClubMemberDirectoryFilters(imported, { ...filters, access: "access_eligible" }), false);
  assert.equal(matchesClubMemberDirectoryFilters({ ...imported, r12Linked: true, credentialIssued: true, accessEligible: true }, { ...filters, access: "access_eligible" }), true);
  assert.equal(matchesClubMemberDirectoryFilters({ ...imported, credentialIssued: undefined }, { ...filters, access: "credential_issued" }), false);
});

test("directory projection is an authorised, boolean-only point-in-time query with separate account and PIN/QR facts", () => {
  const migration = readFileSync("supabase/migrations/2027-02-13-member-access-and-coach-search-acceptance.sql", "utf8");
  const body = migration.slice(migration.indexOf("create or replace function public.club_list_member_directory_access_facts"), migration.indexOf("revoke all on function public.club_list_member_directory_access_facts"));
  assert.match(body, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.view'\)/);
  assert.match(body, /'membership_active'/);
  assert.match(body, /'r12_linked'/);
  assert.match(body, /'account_verified'/);
  assert.match(body, /'credential_issued'/);
  assert.match(body, /'access_eligible'/);
  assert.match(body, /credential_type='pin' and ac\.pin_length=6/);
  assert.doesNotMatch(body, /credential_hash|secret_ciphertext|display_suffix/);
  assert.match(body, /club_membership_access_window_allows\(m\.id,now\(\)\)/);
});

test("Coach search can use the organisation-scoped Club customer name without widening member or coach scope", () => {
  const migration = readFileSync("supabase/migrations/2027-02-13-member-access-and-coach-search-acceptance.sql", "utf8");
  const body = migration.slice(migration.indexOf("create or replace function public.coach_search_club_members"), migration.indexOf("revoke all on function public.coach_search_club_members"));
  assert.match(body, /left join public\.profiles p on p\.id=m\.user_id/);
  assert.match(body, /c\.organisation_id=m\.organisation_id and c\.user_id=m\.user_id/);
  assert.match(body, /m\.organisation_id=p_organisation_id and m\.active and m\.role='member'/);
  assert.match(body, /coach_member\.active and coach_member\.role in \('trainer','gym_staff','gym_admin','owner'\)/);
  assert.match(body, /cp\.organisation_id=m\.organisation_id and cp\.user_id=auth\.uid\(\) and cp\.active/);
  assert.match(body, /coach_has_explicit_access\(auth\.uid\(\)\)/);
  assert.match(body, /position\(lower\(btrim\(p_query\)\) in lower\(coalesce\(customer_name,''\)\)\)/);
  assert.doesNotMatch(body, /email|phone|date_of_birth/);
});

test("DOB is optional in joining UI/RPC, existing DOB survives omission, and child restrictions remain authoritative", () => {
  const form = readFileSync("components/club-joining-form.tsx", "utf8");
  const action = readFileSync("app/club/join/actions.ts", "utf8");
  const migration = readFileSync("supabase/migrations/2027-02-13-member-access-and-coach-search-acceptance.sql", "utf8");
  assert.match(form, /dateOfBirth: String\(form\.get\("dateOfBirth"\) \|\| ""\) \|\| undefined/);
  assert.match(form, /name="dateOfBirth" type="date"\s*\/>/);
  assert.match(action, /p_date_of_birth: input\.dateOfBirth \|\| null/);
  assert.match(migration, /p_date_of_birth is not null and p_date_of_birth>=current_date/);
  assert.match(migration, /date_of_birth=coalesce\(p_date_of_birth,date_of_birth\)/);
  assert.match(migration, /v_checkout:=case.*monthly_recurring/s);
  assert.match(migration, /joining_fee_minor=v_joining_fee/);
  assert.match(migration, /recurring_provider=case when v_checkout='monthly_recurring' then 'gocardless' end/);
  assert.match(migration, /from public,anon,authenticated;\s*\n\s*commit;/);
  assert.match(migration, /age_state='under_16' then age_block := 'under_16_restricted'/);
  assert.match(migration, /age_state='under_18' then age_block := 'under_18_restricted'/);
  assert.match(migration, /age_state='date_of_birth_conflict' then age_block := 'date_of_birth_conflict'/);
  assert.match(migration, /twentyFourHourEligible',membership_valid and is_door_controlled and age_state='adult'/);
});

test("invitation preview failure exposes only a safe SQL/API diagnostic code and never sends", () => {
  const page = readFileSync("app/club/members/activation/page.tsx", "utf8");
  const ui = readFileSync("components/club-member-activation-invitations.tsx", "utf8");
  assert.match(page, /safePreviewFailure\(previewError\?\.code\)/);
  assert.match(page, /PGRST202/);
  assert.match(page, /57014/);
  assert.match(page, /No email has been sent/);
  assert.match(ui, /Duplicate or shared email/);
  assert.match(ui, /Not linked to R12/);
  assert.match(ui, /Excluded from invitation/);
  assert.match(ui, /window\.confirm/);
});

test("Member Home has one shop action surface, retains order history without redundant subtitle, and renames class titles in all home paths", () => {
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  const schedule = readFileSync("app/member-hub/schedule/page.tsx", "utf8");
  const classes = readFileSync("app/member-hub/classes/page.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(hub, /className="member-hub-link member-shop-cta"/);
  assert.doesNotMatch(hub, /member-hub-link primary[^>]*Open Member Shop/);
  assert.match(hub, /Order history/);
  assert.doesNotMatch(hub, /View previous purchases/);
  assert.match(hub, /memberClassDisplayTitle\(session\.title/);
  assert.match(hub, /memberClassDisplayTitle\(event\.title/);
  assert.match(schedule, /memberClassDisplayTitle\(item\.title/);
  assert.doesNotMatch(classes, /module-page club-page member-area-page/);
  assert.match(styles, /\.member-area-page \.member-class-detail-grid span/);
  assert.match(styles, /\.member-hub-shop-summary \.member-shop-cta/);
});

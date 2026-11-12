import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("age checkbox and blur only change local state; explicit confirmation is the only submit path", async () => {
  const [operations, scanner, actions] = await Promise.all([
    read("components/club-sunbed-operations.tsx"),
    read("components/glow-zone-reception-scanner.tsx"),
    read("app/club/sunbeds/actions.ts"),
  ]);
  assert.match(operations, /checked=\{adultConfirmed\} onChange=\{event => setAdultConfirmed\(event\.target\.checked\)\}/);
  assert.match(scanner, /checked=\{adultConfirmed\} onChange=\{event => setAdultConfirmed\(event\.target\.checked\)\}/);
  assert.doesNotMatch(operations, /onBlur=|onChange=\{[^}]*verifyGlowAgeAction/);
  assert.doesNotMatch(scanner, /onBlur=|onChange=\{[^}]*verifyGlowAgeAction/);
  assert.match(operations, /type="button"[^>]*onClick=\{verify\}/);
  assert.match(scanner, /type="button"[^>]*onClick=\{verify\}/);
  assert.match(operations, /Confirm age verification/);
  assert.match(scanner, /Confirm age verification/);
  assert.match(operations, /verificationInFlight\.current/);
  assert.match(scanner, /verificationInFlight\.current/);
  assert.match(actions, /input\.isAdult!==true/);
  assert.match(actions, /p_is_adult:true/);
  assert.match(actions, /club_glow_record_age_confirmation/);
});

test("Glow Zone page starts with secure scanning and omits the staff hours panel", async () => {
  const [page, scanner] = await Promise.all([read("app/club/sunbeds/page.tsx"), read("components/glow-zone-reception-scanner.tsx")]);
  assert.match(scanner, /Scan customer QR/);
  assert.match(scanner, /Ask the customer to select their minutes and show their session QR code/);
  assert.match(page, /club_location_authorized/);
  assert.match(page, /club_capability_allowed/);
  assert.doesNotMatch(page, /GlowZoneOpeningHours|club_location_service_hours/);
});

test("Glow customer detail UI presents one identity and keeps sales separate from manager adjustments", async () => {
  const ui = await read("components/club-sunbed-operations.tsx");
  assert.match(ui, /id="glow-customer-title"/);
  assert.match(ui, /Recent minute purchases/);
  assert.match(ui, /Recent sessions/);
  assert.match(ui, /Sell minutes/);
  assert.match(ui, /Adjust minute balance/);
  assert.match(ui, /canAdjust \?/);
  assert.match(ui, /Confirm payment and credit minutes/);
  assert.match(ui, /I confirm this is a correction, not a customer purchase/);
  assert.match(ui, /No date of birth or ID details were stored/);
  assert.doesNotMatch(ui, /date_of_birth|home address|document number/i);
});

test("purchase history includes only completed purchased credit lots, not manual or promotional credits", async () => {
  const ui = await read("components/club-sunbed-operations.tsx");
  assert.match(ui, /item\.kind === "credit" && item\.source === "purchased"/);
  assert.match(ui, /item\.kind !== "usage" && !\(item\.kind === "credit" && item\.source === "purchased"\)/);
});

test("phone editing uses the narrow audited RPC and does not edit email or auth identity", async () => {
  const [actions, migration, ui] = await Promise.all([
    read("app/club/sunbeds/actions.ts"),
    read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql"),
    read("components/club-sunbed-operations.tsx"),
  ]);
  assert.match(actions, /updateGlowCustomerPhoneAction/);
  assert.match(actions, /club_glow_update_customer_phone_secure/);
  assert.match(actions, /staffContext\(input,"members\.create"\)/);
  assert.match(migration, /club_glow_carlton_staff_allowed\(p_organisation_id\)/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.create'\)/);
  assert.match(migration, /glow\.customer_phone_updated/);
  assert.match(migration, /jsonb_build_object\('changed_fields',jsonb_build_array\('phone'\)\)/);
  assert.match(migration, /revoke all on function public\.club_glow_update_customer_phone_secure\(uuid,uuid,text\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.club_glow_update_customer_phone_secure\(uuid,uuid,text\) to authenticated/);
  assert.match(ui, /Email and account identity cannot be edited here/);
  assert.doesNotMatch(migration, /set email\s*=|auth\.users\s+set/i);
});

test("linked staff names prefer complete same-account identities without name-based merging", async () => {
  const [helper, migration, overview, classes] = await Promise.all([
    read("lib/club-instructor-name.ts"),
    read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql"),
    read("app/club/page.tsx"),
    read("app/club/classes/page.tsx"),
  ]);
  assert.match(helper, /merged\.set\(identity\.userId, identity\)/);
  assert.match(helper, /nameCompleteness/);
  assert.match(migration, /p\.first_name/);
  assert.match(migration, /p\.last_name/);
  assert.match(overview, /resolveInstructorName\(session\.hostUserId, memberIdentities/);
  assert.match(classes, /resolveInstructorName\(session\.hostUserId, identities/);
  assert.doesNotMatch(helper, /Luke Morris|Luke George|Keenan Freer|Steve Hardy/);
});

test("staff invitation attachment no longer coerces roles or grants Coach access", async () => {
  const migration = await read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql");
  const attach = migration.slice(migration.indexOf("create or replace function public.club_madhouse_attach_staff_invitation"), migration.indexOf("create or replace function public.club_madhouse_reconcile_staff_claim"));
  const trigger = migration.slice(migration.indexOf("create or replace function public.club_madhouse_reconcile_staff_claim"));
  assert.doesNotMatch(attach, /update public\.club_staff_access_grants/);
  assert.doesNotMatch(attach, /coach_requested\s*:=\s*true|intended_role\s*:=\s*'trainer'/);
  assert.match(attach, /a\.location_ids <@ g\.location_ids/);
  assert.match(attach, /cp\.active/);
  assert.match(trigger, /new\.intended_role in \('trainer','gym_admin'\) and new\.coach_requested/);
  assert.match(trigger, /cp\.active/);
  assert.match(migration, /canonical_name='Luke Morris',normalized_name='lukemorris'/);
  assert.match(migration, /canonical_name='Steve Hardy',normalized_name='stevehardy'/);
  assert.doesNotMatch(migration, /update public\.club_members\s+set role|update public\.coach_permissions/i);
});

test("additive migration preflights all tables referenced by its new RPC bodies", async () => {
  const migration = await read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql");
  for (const table of ["club_customers", "club_audit_events", "profiles", "club_members", "club_memberships", "club_membership_holders", "club_products", "club_locations", "club_glow_age_verifications", "club_staff_access_grants", "club_madhouse_staff_assignments", "club_class_sessions", "club_staff_rota_shifts", "coach_permissions"]) {
    assert.match(migration, new RegExp(`to_regclass\\('public\\.${table}'\\) is null`), `${table} prerequisite`);
  }
  for (const signature of ["club_list_staff_accounts(uuid)", "club_list_schedule_staff(uuid)", "club_list_member_identities(uuid)", "club_madhouse_attach_staff_invitation(uuid,uuid,uuid)", "club_madhouse_reconcile_staff_claim()"])
    assert.ok(migration.includes(`to_regprocedure('public.${signature}') is null`), `${signature} prerequisite`);
  assert.match(migration, /pg_get_function_result\(to_regprocedure\('public\.club_madhouse_reconcile_staff_claim\(\)'\)\) <> 'trigger'/);
  assert.match(migration, /proargnames\[1:pronargs\]/);
  assert.match(migration, /TABLE\(member_iduuid,user_iduuid,display_nametext,emailtext,roletext,activeboolean,is_gym_memberboolean,membership_nametext\)/);
  assert.match(migration, /create or replace function public\.club_glow_update_customer_phone_secure/);
  assert.match(migration, /revoke all on function public\.club_glow_update_customer_phone_secure/);
});

test("migration guards location, Coach, grant, class, rota and Glow dependencies and scopes claims by organisation", async () => {
  const migration = await read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql");
  for (const [table, column] of [
    ["club_madhouse_staff_assignments", "location_ids"],
    ["club_staff_access_grants", "location_ids"],
    ["coach_permissions", "organisation_id"],
    ["coach_permissions", "user_id"],
    ["coach_permissions", "active"],
    ["club_class_sessions", "organisation_id"],
    ["club_class_sessions", "instructor_assignment_id"],
    ["club_class_sessions", "host_user_id"],
    ["club_class_sessions", "starts_at"],
    ["club_staff_rota_shifts", "organisation_id"],
    ["club_staff_rota_shifts", "staff_assignment_id"],
    ["club_staff_rota_shifts", "staff_user_id"],
    ["club_staff_rota_shifts", "work_date"],
    ["club_glow_age_verifications", "organisation_id"],
    ["club_glow_age_verifications", "user_id"],
    ["club_glow_age_verifications", "date_of_birth"],
  ]) assert.match(migration, new RegExp(`table_name='${table}' and column_name='${column}'`));
  assert.match(migration, /s\.organisation_id=new\.organisation_id and s\.instructor_assignment_id=a\.id/);
  assert.match(migration, /r\.organisation_id=new\.organisation_id and r\.staff_assignment_id=a\.id/);
  assert.match(migration, /where organisation_id=p_organisation_id and instructor_assignment_id=a\.id/);
  assert.match(migration, /where organisation_id=p_organisation_id and staff_assignment_id=a\.id/);
  assert.match(migration, /where id=v_id and organisation_id=v_org and active and normalized_name='luke' and canonical_name='Luke'/);
  assert.match(migration, /where id=v_id and organisation_id=v_org and active and normalized_name='steve' and canonical_name='Steve'/);
  assert.match(migration, /if v_updated<>1 then raise exception/);
});

test("replaced PostgreSQL RPCs preserve their base argument signatures and return types", async () => {
  const replacements = await read("supabase/migrations/2027-01-30-madhouse-glow-identity-and-staff-role-fix.sql");
  const baselines = await Promise.all([
    read("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql"),
    read("supabase/migrations/2026-11-11-club-member-contact-editing.sql"),
    read("supabase/migrations/2026-11-17-club-staff-account-onboarding.sql"),
    read("supabase/migrations/2027-01-15-madhouse-daily-checks-final-fix.sql"),
    read("supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql"),
  ]);
  const definitions = new Map<string, string>([
    ["club_list_schedule_staff", baselines[0]],
    ["club_list_member_identities", baselines[1]],
    ["club_list_staff_accounts", baselines[2]],
    ["club_madhouse_attach_staff_invitation", baselines[3]],
    ["club_madhouse_reconcile_staff_claim", baselines[4]],
  ]);
  const normalize = (sql: string, name: string) => {
    const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
    assert.notEqual(start, -1, `${name} definition`);
    const language = sql.toLowerCase().indexOf(" language ", start);
    assert.notEqual(language, -1, `${name} return type`);
    return sql.slice(start, language).replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim().toLowerCase();
  };
  for (const [name, baseline] of definitions) assert.equal(normalize(replacements, name), normalize(baseline, name), name);
});

test("Overview Glow Zone shortcut is gated by effective permission and authorised Carlton access", async () => {
  const page = await read("app/club/page.tsx");
  assert.match(page, /club_capability_allowed/);
  assert.match(page, /club_location_authorized/);
  assert.match(page, /canOpenGlowZone \? <Link/);
  assert.match(page, /href=\{`\/club\/sunbeds\?org=/);
  assert.match(page, />Glow Zone </);
});

test("directory labels derive active role and Coach permission separately", async () => {
  const page = await read("app/club/staff/page.tsx");
  assert.match(page, /roleLabel\(member\.role\)/);
  assert.match(page, /coachEnabled && member\.role !== "trainer"/);
  assert.match(page, /matchingStaff\.length === 1/);
  assert.match(page, /Several staff share this first name/);
  assert.match(page, /String\(grant\.display_name\).*email_normalized/);
});

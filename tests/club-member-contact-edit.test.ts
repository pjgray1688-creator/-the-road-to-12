import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("member contact editing is capability gated and scoped to linked organisation customer records", () => {
  const migration = read("supabase/migrations/2026-11-11-club-member-contact-editing.sql");
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.create'\)/);
  assert.match(migration, /where organisation_id=p_organisation_id and user_id=p_user_id for update/);
  assert.match(migration, /member\.contact_updated/);
  assert.match(migration, /concat_ws\(' ',p\.first_name,p\.last_name\)/);
  assert.doesNotMatch(migration, /auth\.users|club_memberships|club_entitlement_grants|club_payment_attempts/);
  const action = read("app/club/members/[userId]/actions.ts");
  assert.match(action, /hasCapability\(context\.organisation\.id, user\.id, "members\.create"\)/);
  assert.match(action, /club_update_member_contact/);
});

test("member record onboarding remains available because it is an active creation and assignment workflow", () => {
  const page = read("app/club/members/page.tsx");
  const component = read("components/club-member-onboarding.tsx");
  assert.match(page, /ClubMemberOnboarding/);
  assert.match(component, /New member/);
  assert.match(component, /Existing member/);
  assert.match(component, /Add or assign a membership/);
  assert.match(component, /Create a member record or assign a membership to an existing customer/);
});

test("linked member profiles show the name once and retain contact editing", () => {
  const linked = read("app/club/members/[userId]/page.tsx");
  const customer = read("app/club/members/customer/[customerId]/page.tsx");
  assert.doesNotMatch(linked, /IDENTITY<\/span><h2>\{customer\?\.displayName/);
  assert.doesNotMatch(customer, /IDENTITY<\/span><h2>\{customer\.displayName/);
  assert.match(linked, /<ClubMemberContactEditor/);
});

test("contact editing action has readable purple button states", () => {
  const css = read("components/club-member-contact-editor.module.css");
  assert.match(css, /\.edit,\.save\{background:#633582;color:#fff\}/);
  assert.match(css, /\.edit:hover:not\(:disabled\),\.save:hover:not\(:disabled\)\{background:#51276f;color:#fff\}/);
  assert.match(css, /\.edit:focus-visible,\.save:focus-visible,\.cancel:focus-visible/);
  assert.match(css, /\.edit:disabled,\.save:disabled\{background:#806d8b;color:#fff/);
});

test("Refunds keeps a normal finance KPI grid cell and Export CSV is styled as a compact action", () => {
  const globalCss = read("app/globals.css");
  const shellCss = read("components/club-desktop-shell.module.css");
  const page = read("app/club/payments/page.tsx");
  assert.match(globalCss, /\.club-profile-grid\.club-finance-kpis>section:last-child\{grid-column:auto\}/);
  assert.doesNotMatch(globalCss, /\.club-profile-grid\.club-finance-kpis>section:last-child\{grid-column:1\/\-1\}/);
  assert.match(page, /club-finance-export/);
  assert.match(shellCss, /:global\(\.club-finance-export\)[^{]*\{[^}]*text-decoration:none/);
  assert.match(shellCss, /:global\(\.club-finance-export:focus-visible\)/);
});

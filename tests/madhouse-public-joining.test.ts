import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const joinPage=readFileSync("app/join/[clubSlug]/page.tsx","utf8");
const joinStyles=readFileSync("app/join/[clubSlug]/join.module.css","utf8");
const joinForm=readFileSync("components/club-joining-form.tsx","utf8");
const memberLink=readFileSync("app/member-hub/link/page.tsx","utf8");
const account=readFileSync("app/account/page.tsx","utf8");

test("Madhouse public join actions are explicit and keep their safe R12 return routes",()=>{
  assert.match(joinPage,/href=\{`\/account\?mode=signUp&next=\$\{encodeURIComponent\(returnTo\)\}`\}/);
  assert.match(joinPage,/>Join Madhouse</);
  assert.match(joinPage,/>Already a member</);
  assert.match(joinPage,/encodeURIComponent\("\/member-hub\/link"\)/);
  assert.match(joinPage,/mode=signIn&next=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(joinPage,/BrandLockup compact/);
  assert.doesNotMatch(joinPage,/href=["']\/club/);
});

test("a verified Auth user can discover Madhouse plans and start joining without prior staff or club membership",()=>{
  const catalogue=readFileSync("supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql","utf8");
  const start=catalogue.slice(catalogue.indexOf("create or replace function public.club_start_membership_joining_optional_home_location"),catalogue.indexOf("revoke all on function public.club_start_membership_joining_optional_home_location"));
  assert.match(joinPage,/club_list_joinable_organisations/);
  assert.match(joinPage,/club_list_joinable_memberships/);
  assert.match(joinPage,/club_list_join_locations/);
  assert.match(catalogue,/club_list_joinable_memberships/);
  assert.match(catalogue,/checkout_kind.*monthly_recurring|monthly_recurring/s);
  assert.match(start,/if auth\.uid\(\) is null then raise exception 'Authentication required'/);
  assert.doesNotMatch(start,/exists\s*\(\s*select[^;]*from public\.club_members\s+where/);
});

test("join page has scoped premium desktop/mobile actions and readable form controls",()=>{
  assert.match(joinPage,/styles\.joinPage/);
  assert.match(joinStyles,/\.actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(joinStyles,/@media\(max-width:600px\)\{[\s\S]*?\.actions\{grid-template-columns:1fr\}/);
  assert.match(joinStyles,/\.actionPrimary\{[^}]*linear-gradient\([^}]+\}/);
  assert.match(joinStyles,/min-height:48px/);
  assert.match(joinForm,/Saving your details/);
  assert.match(joinForm,/submitting\.current/);
  assert.match(joinForm,/madhouse-price-line/);
  assert.match(joinForm,/name="marketingConsent" type="checkbox" \/>/);
  assert.match(joinForm,/This is optional and does not affect your membership/);
  assert.doesNotMatch(joinForm,/\£(?:10|30|40)(?:\.00)?/);
  assert.match(joinForm,/Access pass/);
  assert.match(joinForm,/signed|secure confirmation/);
  assert.match(joinForm,/role="alert"/);
  assert.match(joinForm,/role="status"/);
});

test("existing-member route authenticates and returns directly to the claim flow",()=>{
  assert.match(memberLink,/redirect\("\/account\?mode=signIn&next=%2Fmember-hub%2Flink"\)/);
  assert.match(memberLink,/club_preview_existing_member_claim/);
  assert.match(account,/authCallbackUrl\(appBaseUrl, context\.next, context\.app\)/);
  assert.match(account,/authDestination/);
});

test("legacy Madhouse member-link path redirects instead of duplicating activation",()=>{
  const redirect=readFileSync("app/member-link/page.tsx","utf8");
  assert.match(redirect,/redirect\("\/member-hub\/link"\)/);
  assert.doesNotMatch(redirect,/createClient|serverSupabase|ClubMemberClaim/);
});

test("launch routing documentation preserves the marketing root and calls out both join path forms",()=>{
  const routing=readFileSync("docs/r12-launch-configuration.md","utf8");
  assert.match(routing,/bare `r12\.live` host/);
  assert.match(routing,/dedicated Vercel domain `https:\/\/app\.r12\.live`/);
  assert.match(routing,/`https:\/\/app\.r12\.live\/api\/webhooks\/stripe`/);
  assert.match(routing,/`https:\/\/app\.r12\.live\/api\/webhooks\/stripe\/products-services`/);
});

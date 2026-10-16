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

test("join page has scoped premium desktop/mobile actions and readable form controls",()=>{
  assert.match(joinPage,/styles\.joinPage/);
  assert.match(joinStyles,/\.actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(joinStyles,/@media\(max-width:600px\)\{[\s\S]*?\.actions\{grid-template-columns:1fr\}/);
  assert.match(joinStyles,/\.actionPrimary\{[^}]*linear-gradient\([^}]+\}/);
  assert.match(joinStyles,/min-height:48px/);
  assert.match(joinForm,/Saving…/);
  assert.match(joinForm,/role="alert"/);
  assert.match(joinForm,/role="status"/);
});

test("existing-member route authenticates and returns directly to the claim flow",()=>{
  assert.match(memberLink,/redirect\("\/account\?mode=signIn&next=%2Fmember-hub%2Flink"\)/);
  assert.match(memberLink,/club_preview_existing_member_claim/);
  assert.match(account,/authCallbackUrl\(appBaseUrl, next\)/);
  assert.match(account,/safeInternalReturnTo/);
});

test("legacy Madhouse member-link path redirects instead of duplicating activation",()=>{
  const redirect=readFileSync("app/member-link/page.tsx","utf8");
  assert.match(redirect,/redirect\("\/member-hub\/link"\)/);
  assert.doesNotMatch(redirect,/createClient|serverSupabase|ClubMemberClaim/);
});

test("launch routing documentation preserves the marketing root and calls out both join path forms",()=>{
  const routing=readFileSync("docs/r12-launch-configuration.md","utf8");
  assert.match(routing,/Keep `\/` and all current marketing paths/);
  assert.match(routing,/both `\/join` and `\/join\/\*`/);
  assert.match(routing,/`\/member-hub\*` \(including `\/member-hub\/link`\)/);
});

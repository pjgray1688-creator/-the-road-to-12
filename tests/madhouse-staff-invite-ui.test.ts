import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync("components/club-staff-access-form.tsx", "utf8");
const page = readFileSync("app/club/staff/page.tsx", "utf8");
const styles = readFileSync("components/club-staff-management.module.css", "utf8");
const actions = readFileSync("app/club/staff/actions.ts", "utf8");

test("staff invitation form uses a readable light panel with labelled, accessible controls", () => {
  assert.match(form, /styles\.accessForm/);
  assert.match(form, /className=\{styles\.fieldLabel\}>Name/);
  assert.match(form, /className=\{styles\.fieldLabel\}>Email/);
  assert.match(form, /<fieldset className=\{styles\.venueFieldset\}><legend>Venue access/);
  assert.match(form, /styles\.checkLabel/);
  assert.match(styles, /background: #fff !important/);
  assert.match(styles, /color: #241d2e/);
  assert.match(styles, /background: #7627c7 !important/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 560px\)/);
});

test("successful invitation resets all form state, closes the panel and refreshes pending invitations", () => {
  const successStart = form.indexOf("if (!result.ok)");
  const failureReturn = form.indexOf("return;", successStart);
  const reset = form.indexOf("formRef.current?.reset()", failureReturn);
  assert.ok(successStart >= 0 && failureReturn > successStart && reset > failureReturn);
  const successBlock = form.slice(reset, form.indexOf("router.refresh()", reset));
  assert.match(successBlock, /setRole\(DEFAULT_ROLE\)/);
  assert.match(successBlock, /setCoachRequested\(false\)/);
  assert.match(successBlock, /detailsRef\.current\.open = false/);
  assert.match(form, /onToggle=\{event => \{\s*if \(event\.currentTarget\.open\) setMessage\(undefined\)/);
  assert.match(form, /router\.refresh\(\)/);
});

test("failed invitation keeps fields and selection for correction", () => {
  const failureStart = form.indexOf("if (!result.ok)");
  const failureEnd = form.indexOf("return;", failureStart);
  const failureBranch = form.slice(failureStart, failureEnd);
  assert.match(failureBranch, /setMessage\(result\.error\)/);
  assert.doesNotMatch(failureBranch, /reset\(|setRole\(|setCoachRequested\(|\.open = false/);
  assert.match(form, /role,\s*locationIds: form\.getAll\("locationIds"\)/);
  assert.match(form, /coachRequested: coachEligible && coachRequested/);
});

test("linked prepared identity shows its email/status and suppresses duplicate link controls", () => {
  assert.match(page, /const linkedGrantId = row\.staff_grant_id/);
  assert.match(page, /String\(grant\.id\) === linkedGrantId/);
  assert.match(page, /linkedGrantId \|\| matchedStaff \? \[\] : pendingRows\.filter/);
  assert.match(page, /const linkedEmail = linkedGrant\?\.email_normalized \?\? matchedStaff\?\.email/);
  assert.match(page, /\{linkedEmail \? <small>\{linkedEmail\}<\/small> : null\}/);
  assert.match(page, /Verified · pending activation/);
  assert.match(page, /matchedStaff\?\.active \? "Active"/);
  assert.match(page, /\{candidates\.length \? <form className=\{staffStyles\.preparedActions\}/);
  assert.match(page, /!activeStaff\.some\(person => normalizedStaffName\(person\.display_name\) === preparedName\)/);
});

test("invitation attachment continues through the existing permission-checked idempotent RPC", () => {
  assert.match(page, /linkOperationalStaffInvitation\(\{ organisationId: context\.organisation\.id, assignmentId, grantId \}\)/);
  assert.match(actions, /manager\.client\.rpc\("club_madhouse_attach_staff_invitation"/);
  assert.match(actions, /revalidatePath\("\/club\/staff"\)/);
});

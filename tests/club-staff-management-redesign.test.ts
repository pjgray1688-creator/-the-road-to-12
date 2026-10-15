import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubCapabilities } from "@/lib/club-capabilities";

const page = readFileSync("app/club/staff/page.tsx", "utf8");
const editor = readFileSync("components/club-staff-manage-access.tsx", "utf8");
const form = readFileSync("components/club-staff-access-form.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const actions = readFileSync("app/club/staff/actions.ts", "utf8");

test("staff roster uses compact rows and keeps active and suspended access distinct", () => {
  assert.match(page, /<h2>Active staff<\/h2>/);
  assert.match(page, /staff-person-avatar/);
  assert.match(page, /roleLabel\(member\.role\)/);
  assert.match(page, /staff-badge/);
  assert.match(page, /venueSummary/);
  assert.match(page, /staff-status/);
  assert.match(editor, /className="secondary staff-manage-trigger" aria-label=\{`Manage \$\{name\}`\}>Manage<\/summary>/);
  assert.match(page, /Suspended access/);
  assert.doesNotMatch(page, /effective permissions|permission-groups.*groups\.map/);
});

test("staff management groups every capability exactly once and collapses details by default", () => {
  const groupSource = editor.match(/const groups: Group\[\] = \[([\s\S]*?)\n\];/)?.[1] ?? "";
  const grouped = [...groupSource.matchAll(/"([a-z]+(?:\.[a-z_]+)+)"/g)].map(match => match[1]);
  assert.equal(grouped.length, clubCapabilities.length);
  assert.deepEqual([...grouped].sort(), [...clubCapabilities].sort());
  assert.match(editor, /<details className="staff-permission-group"/);
  assert.match(editor, /Allowed by exception/);
  assert.match(editor, /Blocked by exception/);
  assert.match(editor, /Role default/);
  assert.match(editor, /Role permissions are applied automatically/);
  assert.match(editor, /setStaffPermission\(/);
});

test("staff manager retains role, venue, Coach and suspension actions behind Manage", () => {
  for (const pattern of [/setStaffRole\(/, /replaceStaffLocations\(/, /setCoachAccess\(/, /setStaffActive\(/]) assert.match(editor, pattern);
  assert.match(editor, /Save role & venues/);
  assert.match(editor, /Enable Coach access/);
  assert.match(editor, /Disable Coach access/);
  assert.match(editor, /Suspend staff access/);
  assert.match(editor, /Reactivate staff access/);
  assert.match(actions, /club_set_staff_role/);
  assert.match(actions, /club_replace_staff_locations/);
  assert.match(actions, /club_save_staff_permission/);
});

test("pending invitations preserve resend and cancel actions with human delivery states", () => {
  assert.match(page, /<h2>Pending invitations<\/h2>/);
  assert.match(page, /resendStaffInvitation\(/);
  assert.match(page, /revokeStaffAccessGrant\(/);
  assert.match(page, /Waiting to send/);
  assert.match(page, /Sent · waiting for acceptance/);
  assert.match(page, /Delivery failed · resend available/);
  assert.match(page, /Expired/);
  assert.doesNotMatch(page, /failure_code\)\}`/);
});

test("add staff, email preview, own permissions and owner controls are progressively disclosed", () => {
  assert.match(form, /<details className="staff-add">/);
  assert.match(form, /Send staff invite/);
  assert.match(form, /nextRole === "trainer"\) setCoachRequested\(true\)/);
  assert.match(page, /Email preview \/ test/);
  assert.match(page, /<details className="staff-own-permissions">/);
  assert.match(page, /context\.role === "owner" \? <details className="staff-owner-control">/);
  assert.match(page, /<ClubOwnerTransfer/);
});

test("responsive staff controls stack without losing their actions on narrow screens", () => {
  assert.match(styles, /@media\(max-width:820px\)\{\.staff-person/);
  assert.match(styles, /@media\(max-width:560px\)\{\.staff-page-actions/);
  assert.match(styles, /\.staff-permission-items\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.staff-invite-actions\{display:flex\}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER_PT_TYPES, staffWorkActions } from "../lib/club-work-types";

test("staff My Work exposes only shift and PT as primary actions", () => {
  assert.deepEqual(staffWorkActions(), ["Log shift", "Log PT"]);
  assert.deepEqual(MEMBER_PT_TYPES.map(([, label]) => label), ["Solo PT", "PT Package", "1-to-1 Transformation"]);
});

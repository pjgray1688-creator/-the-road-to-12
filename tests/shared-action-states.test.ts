import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared action styles preserve app accents and provide tactile, accessible states", async () => {
  const css = await readFile(new URL("../app/presentation.css", import.meta.url), "utf8");
  assert.match(css, /--action-accent:var\(--club-accent,var\(--glow-accent,var\(--accent/);
  assert.match(css, /:active:not\(:disabled\)/);
  assert.match(css, /:focus-visible\{outline:3px/);
  assert.match(css, /:disabled[^}]*opacity:1/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.module-page[\s\S]*\.club-page/);
});

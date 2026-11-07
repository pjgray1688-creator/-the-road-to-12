import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/go/[app]/route";
import { APP_DOWNLOAD_LINKS } from "../lib/app-download-links";

const userAgents = {
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
} as const;

for (const [slug, app] of Object.entries(APP_DOWNLOAD_LINKS)) {
  test(`${slug} immediately redirects iOS and Android to the matching official store, uncached`, async () => {
    for (const [platform, destination] of [["ios", app.apple], ["android", app.googlePlay]] as const) {
      const response = await GET(new Request("https://app.r12.live/go/" + slug, { headers: { "user-agent": userAgents[platform] } }), { params: Promise.resolve({ app: slug }) });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), destination);
      assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
      assert.equal(response.headers.get("content-type"), null);
    }
  });

  test(`${slug} desktop and unknown agents get only the two official store choices`, async () => {
    for (const userAgent of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "R12-Unknown/1.0"]) {
      const response = await GET(new Request("https://app.r12.live/go/" + slug, { headers: { "user-agent": userAgent } }), { params: Promise.resolve({ app: slug }) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
      const body = await response.text();
      assert.ok(body.includes(app.apple));
      assert.ok(body.includes(app.googlePlay));
      assert.ok(!body.includes("Open App") && !body.includes("/training\"") && !body.includes("/club\""));
    }
  });
}

test("store redirects are fixed and cannot be changed with query parameters; invalid app slugs 404", async () => {
  const attackerRequest = new Request("https://app.r12.live/go/training?url=https%3A%2F%2Fevil.example", { headers: { "user-agent": userAgents.ios } });
  const response = await GET(attackerRequest, { params: Promise.resolve({ app: "training" }) });
  assert.equal(response.headers.get("location"), APP_DOWNLOAD_LINKS.training.apple);

  const invalid = await GET(new Request("https://app.r12.live/go/not-an-app"), { params: Promise.resolve({ app: "not-an-app" }) });
  assert.equal(invalid.status, 404);
});

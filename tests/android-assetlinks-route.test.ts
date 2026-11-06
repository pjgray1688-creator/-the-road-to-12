import assert from "node:assert/strict";
import test from "node:test";
import { ANDROID_APPS } from "../lib/android-apps";
import { GET } from "../app/api/android/assetlinks/route";

const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");

test("assetlinks endpoint serves all four associations as public JSON only when complete", async () => {
  const original = process.env.R12_ANDROID_APP_LINKS_JSON;
  try {
    process.env.R12_ANDROID_APP_LINKS_JSON = JSON.stringify(Object.values(ANDROID_APPS).map(app => ({
      package_name: app.packageId,
      sha256_cert_fingerprints: [fingerprint],
    })));
    const response = await GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/);
    assert.equal(response.headers.get("location"), null);
    const body = await response.json() as Array<{ relation: string[]; target: { package_name: string; sha256_cert_fingerprints: string[] } }>;
    assert.equal(body.length, 4);
    assert.deepEqual(body.map(item => item.target.package_name), Object.values(ANDROID_APPS).map(app => app.packageId));
    assert.ok(body.every(item => item.relation.includes("delegate_permission/common.handle_all_urls")));

    process.env.R12_ANDROID_APP_LINKS_JSON = JSON.stringify([{ package_name: ANDROID_APPS.r12.packageId, sha256_cert_fingerprints: [fingerprint] }]);
    const incomplete = await GET();
    assert.equal(incomplete.status, 503);
    assert.match(incomplete.headers.get("content-type") ?? "", /^application\/json(?:;|$)/);
    const incompleteBody = await incomplete.json() as Array<{ target: { package_name: string } }>;
    assert.deepEqual(incompleteBody.map(item => item.target.package_name), [ANDROID_APPS.r12.packageId]);
  } finally {
    if (original === undefined) delete process.env.R12_ANDROID_APP_LINKS_JSON;
    else process.env.R12_ANDROID_APP_LINKS_JSON = original;
  }
});

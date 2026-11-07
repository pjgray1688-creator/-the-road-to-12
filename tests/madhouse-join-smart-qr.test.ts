import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../app/go/join/route";
import { JOIN_SMART_QR_URL, MADHOUSE_JOINING_DESTINATION } from "../lib/app-download-links";
import { accessQrMatrix } from "../lib/qr-code";

test("/go/join directly redirects to the centrally configured joining destination", async () => {
  const response = GET();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), MADHOUSE_JOINING_DESTINATION);
  assert.equal(response.headers.get("content-type"), null);
  assert.equal(JOIN_SMART_QR_URL, "https://app.r12.live/go/join");
});

test("joining redirect ignores query parameters and cannot be changed into an open redirect", () => {
  const response = GET();
  assert.equal(response.headers.get("location"), "https://secure.clubmanagercentral.com/acd47283-1392-4c40-8d63-a908ba7d46d3/Joining.mvc");
});

test("join QR SVG and PNG encode only the permanent R12 join URL", () => {
  assert.equal(accessQrMatrix(JOIN_SMART_QR_URL).length, 33);
  assert.deepEqual(accessQrMatrix(JOIN_SMART_QR_URL), accessQrMatrix("https://app.r12.live/go/join"));
  const svg = readFileSync("public/app-download-qr/join.svg", "utf8");
  const png = readFileSync("public/app-download-qr/join.png");
  assert.match(svg, /<svg[^>]+width="984" height="984"/);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 984);
  assert.equal(png.readUInt32BE(20), 984);
  assert.ok(!svg.includes("clubmanagercentral") && !svg.includes("apps.apple.com") && !svg.includes("play.google.com"));
});

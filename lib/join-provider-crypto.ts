import { createHmac, timingSafeEqual } from "node:crypto";

function equalHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyGoCardlessSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  return equalHex(createHmac("sha256", secret).update(body, "utf8").digest("hex"), signature.trim());
}

export function verifyStripeSignature(body: string, signature: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!signature || !secret) return false;
  const parts = signature.split(",").map(part => part.trim().split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return signatures.some(value => equalHex(expected, value));
}

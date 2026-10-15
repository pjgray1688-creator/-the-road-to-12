import { createHmac, timingSafeEqual } from "node:crypto";

export const CLUB_STATION_COOKIE = "r12_club_station";
export const CLUB_STATION_USER_COOKIE = "r12_club_station_user";
export function stationSessionTtlSeconds() {
  const configured=Number(process.env.R12_CLUB_STATION_TIMEOUT_MINUTES);
  const minutes=Number.isFinite(configured)&&configured>=1?Math.min(configured,120):5;
  return Math.floor(minutes*60);
}
export function stationCookieValue(value: string | undefined) {
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator < 1 || separator === value.length - 1) return undefined;
  return { id: value.slice(0, separator), token: value.slice(separator + 1) };
}
export function signClubStationSession(userId: string, stationId: string, issuedAt = Math.floor(Date.now() / 1000)) {
  const secret = process.env.R12_CLUB_STATION_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("R12_CLUB_STATION_SESSION_SECRET must contain at least 32 bytes");
  const payload = `${userId}.${stationId}.${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}
export function verifyClubStationSession(value: string | undefined, userId: string | undefined, stationId: string | undefined, now = Math.floor(Date.now() / 1000), maxAgeSeconds=stationSessionTtlSeconds()) {
  if (!value || !userId || !stationId) return false;
  const [savedUser, savedStation, timestamp, signature, ...extra] = value.split(".");
  if (extra.length || savedUser !== userId || savedStation !== stationId || !/^\d+$/.test(timestamp ?? "")) return false;
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 30 || issuedAt < now - maxAgeSeconds) return false;
  try {
    const expected = signClubStationSession(savedUser, savedStation, issuedAt).split(".").at(-1)!;
    const left = Buffer.from(signature ?? "", "hex"); const right = Buffer.from(expected, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  } catch { return false; }
}

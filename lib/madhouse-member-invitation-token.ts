import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validInvitationSecret(secret: string | undefined): secret is string {
  return Boolean(secret && Buffer.byteLength(secret, "utf8") >= 32);
}

/** Derive a high-entropy, invitation-specific bearer token without storing it. */
export function deriveMemberInvitationToken(invitationId: string, secret: string) {
  if (!UUID.test(invitationId) || !validInvitationSecret(secret)) throw new Error("Invitation token configuration is invalid");
  return createHmac("sha256", secret).update(`r12:madhouse-member-activation:v1:${invitationId}`).digest("hex");
}

export function hashMemberInvitationToken(token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Invitation token is invalid");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyMemberInvitationToken(invitationId: string, secret: string, tokenHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) return false;
  const expected = Buffer.from(hashMemberInvitationToken(deriveMemberInvitationToken(invitationId, secret)), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}

export function maskInvitationEmail(email: string | null | undefined) {
  if (!email) return "Email unavailable";
  const [local, domain, ...rest] = email.trim().split("@");
  if (!local || !domain || rest.length) return "Invalid email address";
  const visible = local.length < 3 ? `${local[0] ?? ""}••` : `${local[0]}••••`;
  return `${visible}@${domain}`;
}

export function memberInvitationUrl(baseUrl: string, invitationId: string, token: string) {
  if (!UUID.test(invitationId) || !/^[a-f0-9]{64}$/i.test(token)) throw new Error("Invitation link is invalid");
  const url = new URL(`/member-hub/activate?invitation=${encodeURIComponent(invitationId)}`, baseUrl);
  url.hash = `token=${token}`;
  return url.toString();
}

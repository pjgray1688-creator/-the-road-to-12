import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveMemberInvitationToken, hashMemberInvitationToken, maskInvitationEmail, memberInvitationUrl, validInvitationSecret, verifyMemberInvitationToken } from "../lib/madhouse-member-invitation-token";

const invitationId = "d7d19286-9eec-4bb5-b7bf-1df5df2ebc09";
const secret = "a-long-random-server-only-secret-with-more-than-thirty-two-bytes";

describe("Madhouse member invitation tokens", () => {
  it("derives an invitation-specific token and stores only its one-way hash", () => {
    const token = deriveMemberInvitationToken(invitationId, secret);
    const hash = hashMemberInvitationToken(token);
    assert.equal(token.length, 64);
    assert.equal(verifyMemberInvitationToken(invitationId, secret, hash), true);
    assert.equal(verifyMemberInvitationToken("f812e44b-f339-4aab-80b2-439d255aab80", secret, hash), false);
    assert.equal(verifyMemberInvitationToken(invitationId, `${secret}-rotated`, hash), false);
  });

  it("rejects weak/missing signing secrets and malformed tokens", () => {
    assert.equal(validInvitationSecret(undefined), false);
    assert.equal(validInvitationSecret("short"), false);
    assert.throws(() => deriveMemberInvitationToken(invitationId, "short"));
    assert.throws(() => hashMemberInvitationToken("not-a-token"));
  });

  it("keeps the bearer token in the URL fragment, not the request query", () => {
    const token = deriveMemberInvitationToken(invitationId, secret);
    const url = new URL(memberInvitationUrl("https://app.r12.live", invitationId, token));
    assert.equal(url.searchParams.get("invitation"), invitationId);
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(url.hash, `#token=${token}`);
  });

  it("masks an address without changing the actual delivery recipient", () => {
    assert.equal(maskInvitationEmail("peter.gray@gmail.com"), "p••••@gmail.com");
    assert.equal(maskInvitationEmail("ab@example.org"), "a••@example.org");
    assert.equal(maskInvitationEmail("not-an-email"), "Invalid email address");
    assert.equal(maskInvitationEmail(null), "Email unavailable");
  });
});

/**
 * A02/A02S documented JSON response shape only. This is deliberately not an
 * HTTP endpoint or request parser: no device request is trusted until the
 * installed firmware's TLS, authentication and request format are verified.
 */
export type AuthoritativeAccessDecision = {
  allowed: boolean;
  decision: "allow" | "deny";
  unlockPermitted: boolean;
};

export function akuvoxA02Response(decision: AuthoritativeAccessDecision): string {
  // A membership can be eligible for staffed check-in while the location is
  // not configured to unlock a physical door. Require the explicit server
  // unlock decision as well as the access decision.
  const isvalid = decision.allowed === true
    && decision.decision === "allow"
    && decision.unlockPermitted === true;
  return JSON.stringify({ isvalid });
}

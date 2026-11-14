/**
 * A02/A02S documented JSON response shape only. This is deliberately not an
 * HTTP endpoint or request parser: no device request is trusted until the
 * installed firmware's TLS, authentication and request format are verified.
 */
export type AuthoritativeAccessDecision = {
  allowed: boolean;
  decision: "allow" | "deny";
};

export function akuvoxA02Response(decision: AuthoritativeAccessDecision): string {
  const isvalid = decision.allowed === true && decision.decision === "allow";
  return JSON.stringify({ isvalid });
}

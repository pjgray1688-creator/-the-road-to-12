export const GOLDEN_TICKET_LIFETIME_LABEL = "Golden Ticket — Lifetime Membership";

export function membershipPresentation(productName: string | undefined, isLifetime: boolean) {
  return isLifetime
    ? { name: GOLDEN_TICKET_LIFETIME_LABEL, validity: "Never expires" }
    : { name: productName ?? "Membership", validity: undefined };
}

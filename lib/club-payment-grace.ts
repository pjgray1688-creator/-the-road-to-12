export const graceExtensionEligibleStates = ["failed", "grace", "retry_scheduled", "overdue"] as const;

export type GraceExtensionContext = {
  obligationId: string;
  membershipId: string;
  state: string;
  eligible: boolean;
  amountMinor: number;
  currency: string;
  originalDueAt: string;
  originalGraceExpiresAt: string;
  currentGraceExpiresAt: string;
  extensionCount: number;
  suspended: boolean;
  coveredHolders: Array<{ customerId?: string; userId?: string; displayName: string }>;
  history: Array<{
    id: string;
    sequence: number;
    previousGraceExpiresAt: string;
    newGraceExpiresAt: string;
    agreedPaymentDate?: string;
    reason: string;
    approvedAt: string;
    approvedByName: string;
    coveredHolders: Array<{ customerId?: string; userId?: string; displayName: string }>;
    closedAt?: string;
  }>;
};

export function isGraceExtensionEligible(state: string) {
  return graceExtensionEligibleStates.includes(state as (typeof graceExtensionEligibleStates)[number]);
}

export function graceArrangementState(context: Pick<GraceExtensionContext, "state" | "suspended" | "extensionCount" | "currentGraceExpiresAt">, now = new Date()) {
  if (context.state === "paid") return "Paid";
  if (context.state === "recovered") return "Recovered";
  if (context.suspended) return "Suspended";
  if (context.extensionCount > 0 && Date.parse(context.currentGraceExpiresAt) > now.getTime()) return "Extended grace";
  if (context.state === "overdue") return "Overdue";
  return "Standard grace";
}

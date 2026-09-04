export type BillingState = "upcoming" | "due" | "failed" | "grace" | "retry_scheduled" | "overdue" | "paid" | "recovered" | "cancelled";
export type BillingPolicy = { gracePeriodDays?: number | null; suspendAfterDays?: number | null; accessSuspensionEnabled?: boolean };

export function evaluateBillingState(state: BillingState, dueAt: Date, now: Date, policy: BillingPolicy): BillingState {
  if (["paid", "recovered", "cancelled"].includes(state)) return state;
  if (dueAt > now) return state === "upcoming" ? "upcoming" : state;
  const days = Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000));
  if (policy.accessSuspensionEnabled && policy.suspendAfterDays != null && days >= policy.suspendAfterDays) return "overdue";
  return state === "upcoming" || state === "due" || state === "failed" ? "grace" : state;
}

export function lifecycleNotificationKey(obligationId: string, stage: string) { return `billing:${obligationId}:${stage}`; }

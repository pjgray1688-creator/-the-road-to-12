/** Provider-neutral Club cash declarations, service credits, membership charges and offers. */
export type ClubCashDeclarationPurpose = "commerce_order" | "membership" | "balance_top_up" | "other";
export type ClubCashDeclarationStatus = "declared" | "confirmed" | "rejected" | "cancelled" | "discrepancy";
export type ClubServiceCreditUnit = "minute" | "session" | "class" | "credit" | "custom";
export type ClubServiceCreditEntryType = "grant" | "purchase_grant" | "promotion_grant" | "manual_adjustment" | "usage" | "refund_restoration" | "expiry";
export type ClubInitialChargeType = "joining_fee" | "first_period" | "setup_fee" | "other_initial";
export type ClubPromotionStatus = "draft" | "active" | "paused" | "expired";
export type ClubPromotionEffectType = "percentage_discount" | "fixed_discount" | "waive_charge" | "grant_service_units";
export type ClubPromotionTargetType = "commerce_product" | "commerce_category" | "membership_product" | "membership_initial_charge" | "service" | "all_commerce";

export type ClubCashDeclaration = { id: string; organisationId: string; locationId?: string; purpose: ClubCashDeclarationPurpose; userId?: string; customerId?: string; orderId?: string; membershipId?: string; declaredAmountMinor: number; currency: string; status: ClubCashDeclarationStatus; declaredAt: string; confirmedAt?: string; confirmedBy?: string; discrepancyMinor?: number; notes?: string; idempotencyKey?: string; createdAt: string; updatedAt: string };
export type ClubServiceCreditAccount = { id: string; organisationId: string; userId?: string; customerId?: string; creditKey: string; unit: ClubServiceCreditUnit; status: "active" | "suspended" | "closed" };
export type ClubServiceCreditEntry = { id: string; accountId: string; organisationId: string; entryType: ClubServiceCreditEntryType; quantityDelta: number; balanceAfter: number; orderId?: string; serviceId?: string; promotionId?: string; actorUserId?: string; idempotencyKey?: string; occurredAt: string };
export type ClubMembershipInitialCharge = { id: string; organisationId: string; productId: string; chargeType: ClubInitialChargeType; amountMinor: number; currency: string; required: boolean; active: boolean; position: number; createdAt: string; updatedAt: string };
export type ClubPromotionTarget = { id: string; promotionId: string; organisationId: string; targetType: ClubPromotionTargetType; commerceProductId?: string; categoryKey?: string; membershipProductId?: string; serviceId?: string; chargeType?: ClubInitialChargeType; targetKey?: string };
export type ClubPromotion = { id: string; organisationId: string; name: string; description?: string; status: ClubPromotionStatus; startsAt: string; endsAt?: string; locationIds?: string[]; eligibility: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string; targets?: ClubPromotionTarget[] };
export type ClubPromotionEffect = { id: string; promotionId: string; effectType: ClubPromotionEffectType; percentageBasisPoints?: number; amountMinor?: number; chargeType?: ClubInitialChargeType; creditKey?: string; creditUnit?: ClubServiceCreditUnit; creditQuantity?: number; };
export type ClubPromotionRedemption = { id: string; promotionId: string; organisationId: string; userId?: string; customerId?: string; orderId?: string; membershipId?: string; discountMinor: number; unitsGranted: number; redeemedAt: string; locationId?: string; idempotencyKey?: string };

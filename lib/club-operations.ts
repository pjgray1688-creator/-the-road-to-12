/** Provider-neutral Club classes, bookings, customers and venue-service contracts. */
export type ClubCustomerStatus = "guest" | "member" | "customer";
export type ClubCustomer = { id: string; organisationId: string; userId?: string; displayName: string; email?: string; phone?: string; status: ClubCustomerStatus; createdAt: string; updatedAt: string };

export type ClubClassType = { id: string; organisationId: string; name: string; description?: string; defaultDurationMinutes: number; defaultCapacity?: number; active: boolean; createdAt: string; updatedAt: string };
export type ClubClassSessionStatus = "scheduled" | "cancelled" | "completed";
export type ClubClassSessionVisibility = "public" | "members_only" | "private";
export type ClubClassSession = {
  id: string; organisationId: string; locationId: string; classTypeId: string; hostUserId?: string; title?: string;
  startsAt: string; endsAt: string; capacity?: number; bookingOpensAt?: string; bookingClosesAt?: string; cancellationClosesAt?: string;
  visibility: ClubClassSessionVisibility; status: ClubClassSessionStatus; recurrenceMetadata?: Record<string, unknown>; createdAt: string; updatedAt: string;
};

export type ClubBookingStatus = "confirmed" | "cancelled" | "waitlisted";
export type ClubAttendanceState = "pending" | "checked_in" | "attended" | "no_show";
export type ClubClassBooking = {
  id: string; organisationId: string; sessionId: string; customerId: string; status: ClubBookingStatus; bookedAt: string; cancelledAt?: string;
  attendanceState: ClubAttendanceState; entitlementUsageId?: string; paymentReference?: string; createdAt: string; updatedAt: string;
};

export type ClubService = {
  id: string; organisationId: string; locationId?: string; name: string; description?: string; category: string; durationMinutes?: number;
  priceMinor?: number; currency: string; active: boolean; createdAt: string; updatedAt: string;
};
export type ClubPaymentStatus = "unpaid" | "pending" | "paid" | "waived" | "refunded";
export type ClubFulfilmentStatus = "pending" | "fulfilled" | "cancelled" | "failed";
export type ClubServiceTransaction = {
  id: string; organisationId: string; locationId: string; serviceId: string; customerId?: string; staffUserId?: string; quantity: number;
  unitPriceMinor: number; currency: string; paymentStatus: ClubPaymentStatus; paymentMethod?: string; paymentReference?: string;
  fulfilmentStatus: ClubFulfilmentStatus; externalFulfilmentReference?: string; occurredAt: string; metadata?: Record<string, unknown>; createdAt: string; updatedAt: string;
};

type Mutable<T> = Omit<T, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type SaveClubClassTypeInput = Mutable<ClubClassType>;
export type SaveClubClassSessionInput = Mutable<ClubClassSession>;
export type CreateClubCustomerInput = Omit<ClubCustomer, "id" | "createdAt" | "updatedAt">;
export type SaveClubServiceInput = Mutable<ClubService>;
export type CreateClubServiceTransactionInput = Omit<ClubServiceTransaction, "id" | "staffUserId" | "createdAt" | "updatedAt">;
export type UpdateClubServiceTransactionInput = Pick<ClubServiceTransaction, "paymentStatus" | "fulfilmentStatus"> & Partial<Pick<ClubServiceTransaction, "paymentMethod" | "paymentReference" | "externalFulfilmentReference" | "metadata">>;

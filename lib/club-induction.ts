export type ClubInductionRequirement = "none" | "online_or_in_person" | "in_person";
export type ClubInductionOverdueAccess = "allow" | "hold";
export type ClubInductionRoute = "online" | "in_person";
export type ClubInductionState = "not_required" | "due" | "booked" | "complete" | "overdue";
export type ClubInductionBookingStatus = "booked" | "completed" | "cancelled" | "no_show";

export type ClubInductionPolicy = {
  id: string; organisationId: string; locationId?: string; requirement: ClubInductionRequirement;
  graceDays: number; overdueAccess: ClubInductionOverdueAccess; appointmentExtensionEnabled: boolean;
  maxAppointmentExtensionDays?: number; requiresReacknowledgement: boolean; active: boolean;
  createdAt: string; updatedAt: string;
};
export type ClubInductionVersion = { id: string; policyId: string; organisationId: string; version: number; status: "draft" | "published"; effectiveAt: string; createdAt: string; publishedAt?: string };
export type ClubInductionContentSection = { id: string; versionId: string; position: number; sectionKey: string; title: string; content: string; requiresAcknowledgement: boolean };
export type ClubInductionBooking = { id: string; organisationId: string; userId: string; locationId: string; versionId?: string; startsAt: string; endsAt: string; status: ClubInductionBookingStatus; createdAt: string; completedAt?: string; verifiedBy?: string };
export type ClubInductionStateRead = { state: ClubInductionState; required: boolean; route?: ClubInductionRoute; policyId?: string; versionId?: string; dueAt?: string; graceRemainingDays?: number; booking?: ClubInductionBooking; completedAt?: string; verifiedBy?: string; accessEffect: "none" | "warn" | "hold"; requirement?: ClubInductionRequirement };
export type ClubInductionRead = { policy?: ClubInductionPolicy; version?: ClubInductionVersion; sections: ClubInductionContentSection[]; state: ClubInductionStateRead };
export type SaveClubInductionPolicyInput = Omit<ClubInductionPolicy, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type SaveClubInductionVersionInput = Omit<ClubInductionVersion, "id" | "createdAt" | "publishedAt"> & { id?: string; sections: Array<Omit<ClubInductionContentSection, "id" | "versionId">> };

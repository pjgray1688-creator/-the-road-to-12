import type { SupabaseClient } from "@supabase/supabase-js";
import { clubRepository, type ClubRepository } from "./club-repository";
import type { ClubRole, Organisation, OrganisationMember } from "./club";

const operationalRoles: ClubRole[] = ["trainer", "gym_staff", "gym_admin", "owner"];

export type ClubOrganisationContext = {
  repository: ClubRepository;
  organisation: Organisation;
  members: OrganisationMember[];
  member: OrganisationMember;
  role: ClubRole;
  navigation: { members: boolean; payments: boolean; management?: boolean; finance?: boolean; cashControls?: boolean; cashTill?: boolean; balanceTopUp?: boolean; collections?: boolean; classSetup?: boolean; memberships?: boolean; memberImports?: boolean; promotions?: boolean; suppliers?: boolean; supplierOrders?: boolean; staff?: boolean; stationAdmin?: boolean; venues?: boolean; reports?: boolean; services?: boolean; workSubmit?: boolean; workReview?: boolean; dailyChecks?: boolean; classReports?: boolean; coachDiary?: boolean; induction?: boolean; doorAccess?: boolean };
  availableContexts?: Array<Pick<ClubOrganisationContext, "organisation" | "role" | "navigation">>;
};

/** Only serialisable organisation/role data may cross into client navigation. */
export function toClubNavContexts(contexts: ClubOrganisationContext[]) { return contexts.map(context => ({ organisation: context.organisation, role: context.role, navigation: context.navigation })); }

/** Resolve only organisations where the signed-in user has an active membership. */
export async function listClubOrganisationContexts(client: SupabaseClient, userId: string) {
  const repository = clubRepository(client);
  const organisations = await repository.listOrganisations();
  const contexts = await Promise.all(organisations.map(async (organisation): Promise<ClubOrganisationContext | undefined> => {
    const members = await repository.listMembers(organisation.id);
    const member = members.find(item => item.userId === userId && item.active);
    if (!member) return undefined;
    const [canViewMembers, finance, cashControls, memberships, memberImports, promotions, suppliers, supplierOrders, supplierReceive, staff, venues, reports, services, workSubmit, workReview, classManagement, cashTaking, induction, coachDiary] = await Promise.all([
      repository.hasCapability(organisation.id, userId, "members.view"),
      repository.hasCapability(organisation.id, userId, "finance.view"),
      repository.hasCapability(organisation.id, userId, "cash.reconcile"),
      repository.hasCapability(organisation.id, userId, "memberships.manage"),
      repository.hasCapability(organisation.id, userId, "members.import"),
      repository.hasCapability(organisation.id, userId, "commerce.pricing_manage"),
      repository.hasCapability(organisation.id, userId, "supplier.catalogue_manage"),
      repository.hasCapability(organisation.id, userId, "supplier.orders_manage"),
      repository.hasCapability(organisation.id, userId, "supplier.receive"),
      repository.hasCapability(organisation.id, userId, "staff.permissions_manage"),
      repository.hasCapability(organisation.id, userId, "induction.manage_policy"),
      repository.hasCapability(organisation.id, userId, "finance.export"),
      repository.hasCapability(organisation.id, userId, "services.manage"),
      repository.hasCapability(organisation.id, userId, "staff.work_submit"),
      repository.hasCapability(organisation.id, userId, "staff.work_review"),
      repository.hasCapability(organisation.id, userId, "classes.manage"),
      repository.hasCapability(organisation.id, userId, "payments.record_cash"),
      repository.hasCapability(organisation.id, userId, "induction.perform"),
      ["trainer", "gym_staff", "gym_admin", "owner"].includes(member.role)
        ? client.rpc("coach_has_access", { p_client_user_id: null }).then(result => !result.error && result.data === true)
        : Promise.resolve(false),
    ]);
    const classSetup = member.role === "gym_admin" || member.role === "owner";
    const classReports = classManagement && (cashTaking || cashControls);
    const navigation = { members: canViewMembers, doorAccess: canViewMembers, payments: finance, finance, cashControls, cashTill: canViewMembers, balanceTopUp: cashTaking, collections: supplierReceive, classSetup, memberships, memberImports, promotions, suppliers, supplierOrders, staff, stationAdmin: staff, venues, reports, services, workSubmit, workReview, dailyChecks: workSubmit || workReview, classReports, coachDiary, induction, management: finance || cashControls || classSetup || memberships || memberImports || promotions || suppliers || staff || venues || reports || workReview };
    return { repository, organisation, members, member, role: member.role, navigation } satisfies ClubOrganisationContext;
  }));
  return contexts.filter((context): context is ClubOrganisationContext => Boolean(context));
}

/** An explicit organisation is required when a user belongs to more than one. */
export async function resolveClubOrganisationContext(client: SupabaseClient, userId: string, organisationId?: string) {
  const contexts = await listClubOrganisationContexts(client, userId);
  const selected = organisationId ? contexts.find(context => context.organisation.id === organisationId) : contexts.length === 1 ? contexts[0] : undefined;
  return selected ? { ...selected, availableContexts: toClubNavContexts(contexts) } : undefined;
}

export async function resolveClubOperationalContext(client: SupabaseClient, userId: string, organisationId?: string) {
  const context = await resolveClubOrganisationContext(client, userId, organisationId);
  return context && operationalRoles.includes(context.role) ? context : undefined;
}

export function isClubOperationalRole(role: ClubRole) { return operationalRoles.includes(role); }
export function isClubStaffRole(role: ClubRole) { return operationalRoles.includes(role); }

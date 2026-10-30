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
  navigation: { members: boolean; payments: boolean; management?: boolean; finance?: boolean; memberships?: boolean; promotions?: boolean; suppliers?: boolean; staff?: boolean; venues?: boolean; reports?: boolean; services?: boolean };
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
    const [canViewMembers, finance, memberships, promotions, suppliers, staff, venues, reports, services] = await Promise.all([
      repository.hasCapability(organisation.id, userId, "members.view"),
      repository.hasCapability(organisation.id, userId, "finance.view"),
      repository.hasCapability(organisation.id, userId, "memberships.manage"),
      repository.hasCapability(organisation.id, userId, "commerce.pricing_manage"),
      repository.hasCapability(organisation.id, userId, "supplier.catalogue_manage"),
      repository.hasCapability(organisation.id, userId, "staff.permissions_manage"),
      repository.hasCapability(organisation.id, userId, "induction.manage_policy"),
      repository.hasCapability(organisation.id, userId, "finance.export"),
      repository.hasCapability(organisation.id, userId, "services.manage"),
    ]);
    const navigation = { members: canViewMembers, payments: finance, finance, memberships, promotions, suppliers, staff, venues, reports, services, management: finance || memberships || promotions || suppliers || staff || venues || reports || services };
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

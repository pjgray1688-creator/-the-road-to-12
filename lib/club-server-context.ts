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
  availableContexts?: Array<Pick<ClubOrganisationContext, "organisation" | "role">>;
};

/** Only serialisable organisation/role data may cross into client navigation. */
export function toClubNavContexts(contexts: ClubOrganisationContext[]) { return contexts.map(context => ({ organisation: context.organisation, role: context.role })); }

/** Resolve only organisations where the signed-in user has an active membership. */
export async function listClubOrganisationContexts(client: SupabaseClient, userId: string) {
  const repository = clubRepository(client);
  const organisations = await repository.listOrganisations();
  const contexts = await Promise.all(organisations.map(async organisation => {
    const members = await repository.listMembers(organisation.id);
    const member = members.find(item => item.userId === userId && item.active);
    return member ? { repository, organisation, members, member, role: member.role } satisfies ClubOrganisationContext : undefined;
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
export function isClubStaffRole(role: ClubRole) { return role === "gym_staff" || role === "gym_admin" || role === "owner"; }

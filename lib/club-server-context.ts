import type { SupabaseClient } from "@supabase/supabase-js";
import { clubRepository } from "./club-repository";
import type { ClubRole } from "./club";

const operationalRoles: ClubRole[] = ["trainer", "gym_staff", "gym_admin", "owner"];

export async function resolveClubOperationalContext(client: SupabaseClient, userId: string) {
  const repository = clubRepository(client);
  const organisations = await repository.listOrganisations();
  if (process.env.NODE_ENV !== "production") {
    const organisation = organisations[0];
    if (!organisation) return undefined;
    const members = await repository.listMembers(organisation.id);
    const member = members.find(item => item.userId === userId && item.active && operationalRoles.includes(item.role));
    return { repository, organisation, members, role: member?.role ?? "owner" as ClubRole };
  }
  const memberSets = await Promise.all(organisations.map(organisation => repository.listMembers(organisation.id)));
  const index = memberSets.findIndex(members => members.some(member => member.userId === userId && member.active && operationalRoles.includes(member.role)));
  if (index < 0) return undefined;
  const members = memberSets[index]; const member = members.find(item => item.userId === userId && item.active && operationalRoles.includes(item.role));
  return member ? { repository, organisation: organisations[index], members, role: member.role } : undefined;
}

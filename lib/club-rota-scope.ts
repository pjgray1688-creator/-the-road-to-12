export type ClubRotaScope = "mine" | "team";

export function resolveRotaScope(role: string, requested: string | undefined): ClubRotaScope {
  if (role !== "owner" && role !== "gym_admin") return "mine";
  return requested === "team" ? "team" : "mine";
}

export function filterRotaStaff<T extends { userId: string }>(staff: readonly T[], scope: ClubRotaScope, userId: string) {
  return scope === "team" ? [...staff] : staff.filter(person => person.userId === userId);
}

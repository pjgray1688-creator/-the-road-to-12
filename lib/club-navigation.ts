import type { ClubRole } from "./club";
export type ClubNavigationLink = { label: string; href: string };
/** Presentation only; each destination retains its own server capability checks. */
export function clubNavigationLinks(role: ClubRole, organisationId: string, locationId?: string): ClubNavigationLink[] {
  const q = `?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`;
  const operational = ["trainer", "gym_staff", "gym_admin", "owner"].includes(role);
  const admin = ["gym_admin", "owner"].includes(role);
  const paths = operational ? [
    ["Overview", "/club"], ["Reception", "/club/reception"], ["Members", "/club/members"],
    ["Daily checks", "/club/checks"], ["Inductions", "/club/induction"], ["Shop", "/club/shop"],
    ["Glow Zone", "/club/sunbeds"], ["Classes", "/club/classes"], ["Staff & PT schedule", "/club/schedule"],
    ["My Work", "/club/work"], ...(admin ? [["Finance", "/club/payments"], ["Reports", "/club/reports"],
      ["Locations", "/club/locations"], ["Staff", "/club/staff"], ["Shared stations", "/club/stations"], ["Launch readiness", "/club/launch-readiness"]] : []),
    ["Account", "/club/account"],
  ] : [["Overview", "/club"], ["Classes", "/club/classes"], ["Shop", "/club/shop"], ["Membership payments", "/club/membership-billing"]];
  return paths.map(([label, path]) => ({ label, href: path + q }));
}
export function activeClubNavigationPath(pathname: string): string {
  if (pathname.startsWith("/club/products") || pathname.startsWith("/club/promotions")) return "/club/shop";
  return pathname === "/club" ? pathname : "/" + pathname.split("/").filter(Boolean).slice(0, 2).join("/");
}

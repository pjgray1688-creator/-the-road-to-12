export type HomeMemberOrganisation = { id: string; name: string; slug?: string };
export type HomeMemberShortcut = { label: "Classes" | "Gym Access" | "Shop"; icon: "calendar" | "access" | "bag"; href: string };

export function homeMemberAreaCard(organisation: HomeMemberOrganisation) {
  const isMadhouse = `${organisation.slug ?? ""} ${organisation.name}`.toLowerCase().includes("madhouse");
  const organisationQuery = encodeURIComponent(organisation.id);
  const shortcuts: HomeMemberShortcut[] = isMadhouse ? [
    { label: "Classes", icon: "calendar", href: `/member-hub/classes?org=${organisationQuery}` },
    { label: "Gym Access", icon: "access", href: `/member-hub#membership-access-${organisationQuery}` },
    { label: "Shop", icon: "bag", href: `/member-hub/shop?org=${organisationQuery}` },
  ] : [];
  return {
    name: isMadhouse ? "Madhouse Gym" : organisation.name,
    isMadhouse,
    href: "/member-hub",
    shortcuts,
  };
}

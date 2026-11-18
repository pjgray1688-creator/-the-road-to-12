import type { ClubProduct } from "./club";

export type MembershipManagementGroup = { key: string; label: string; products: ClubProduct[] };

/** Group existing management catalogue records; sale visibility never controls inclusion. */
export function membershipManagementGroups(products: ClubProduct[]): MembershipManagementGroup[] {
  const groups: MembershipManagementGroup[] = [
    { key: "off_peak", label: "Off-Peak", products: [] },
    { key: "family", label: "Family", products: [] },
    { key: "couples", label: "Couples", products: [] },
    { key: "standard", label: "Standard", products: [] },
    { key: "lifetime", label: "Lifetime", products: [] },
    { key: "fixed_term", label: "Fixed-term offers", products: [] },
    { key: "passes", label: "Passes", products: [] },
    { key: "other", label: "Other membership products", products: [] },
  ];
  for (const product of products.filter(item => item.kind === "membership")) {
    const name = product.name.normalize("NFKC").toLocaleLowerCase("en-GB");
    const key = product.isLifetime ? "lifetime"
      : /off[\s-]?peak/.test(name) ? "off_peak"
      : /family/.test(name) ? "family"
      : /couple/.test(name) ? "couples"
      : /\bstandard\b|unlimited gym/.test(name) ? "standard"
      : product.fixedTermValue !== undefined && !/\bpass\b/.test(name) ? "fixed_term"
      : product.durationDays !== undefined || /\bpass\b/.test(name) ? "passes"
      : "other";
    groups.find(group => group.key === key)!.products.push(product);
  }
  return groups;
}

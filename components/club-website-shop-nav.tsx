import Link from "next/link";

export function ClubWebsiteShopNav({ organisationId, section }: { organisationId: string; section: "products" | "orders" }) {
  const query = `?org=${encodeURIComponent(organisationId)}`;
  return <nav className="club-website-shop-nav" aria-label="Website Shop management">
    <Link href={`/club/website-shop${query}`} aria-current={section === "products" ? "page" : undefined}>Products &amp; Pricing</Link>
    <Link href={`/club/website-shop/orders${query}`} aria-current={section === "orders" ? "page" : undefined}>Orders</Link>
  </nav>;
}

"use client";
import Link from "next/link";

const tabs = ["sell", "stock", "catalogue", "cash"] as const;
const labels: Record<(typeof tabs)[number], string> = { sell: "Sell", stock: "Stock", catalogue: "Catalogue", cash: "Cash" };

export function ClubShopTabs({ organisationId, locationId, view = "sell" }: { organisationId: string; locationId?: string; view?: string }) {
  const selected = tabs.includes(view as (typeof tabs)[number]) ? view : "sell";
  return <nav className="club-shop-tabs" aria-label="Shop areas">{tabs.map(tab => <Link key={tab} href={`/club/shop?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}&view=${tab}`} aria-current={selected === tab ? "page" : undefined} className={selected === tab ? "active" : undefined}>{labels[tab]}</Link>)}</nav>;
}

"use client";
import Link from "next/link";

const tabs = ["sell", "stock", "catalogue", "cash", "supplier-catalogue", "supplier-orders", "collections"] as const;
const labels: Record<(typeof tabs)[number], string> = { sell: "Sell", stock: "Stock", catalogue: "Products", cash: "Cash", "supplier-catalogue": "Supplier catalogue", "supplier-orders": "Supplier orders", collections: "Collections" };

export function ClubShopTabs({ organisationId, locationId, view = "sell" }: { organisationId: string; locationId?: string; view?: string }) {
  const selected = tabs.includes(view as (typeof tabs)[number]) ? view : "sell";
  return <nav className="club-shop-tabs" aria-label="Shop areas"><Link href={`/club/shop?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}&view=sell`} aria-current={selected === "sell" ? "page" : undefined} className={selected === "sell" ? "active" : undefined}>Sell</Link><Link href={`/club/shop?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}&view=stock`} aria-current={selected === "stock" ? "page" : undefined} className={selected === "stock" ? "active" : undefined}>Stock</Link><Link href={`/club/shop/supplier-catalogue?org=${encodeURIComponent(organisationId)}`}>Supplier catalogue</Link><Link href={`/club/shop/supplier-orders?org=${encodeURIComponent(organisationId)}`}>Supplier orders</Link><Link href={`/club/shop/collections?org=${encodeURIComponent(organisationId)}`}>Collections</Link><Link href={`/club/shop?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}&view=cash`} aria-current={selected === "cash" ? "page" : undefined} className={selected === "cash" ? "active" : undefined}>Cash</Link></nav>;
}

"use client";
import Link from "next/link";

const tabs = ["sell", "stock", "catalogue", "cash", "supplier-catalogue", "supplier-orders", "collections"] as const;

export function ClubShopTabs({ organisationId, locationId, view = "sell", canManage = false }: { organisationId: string; locationId?: string; view?: string; canManage?: boolean }) {
  const selected = tabs.includes(view as (typeof tabs)[number]) ? view : "sell";
  const query = `?org=${encodeURIComponent(organisationId)}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`;
  return <nav className="club-shop-tabs" aria-label="Shop areas"><Link href={`/club/shop${query}&view=sell`} aria-current={selected === "sell" ? "page" : undefined} className={selected === "sell" ? "active" : undefined}>Sell</Link><Link href={`/club/shop${query}&view=stock`} aria-current={selected === "stock" ? "page" : undefined} className={selected === "stock" ? "active" : undefined}>Stock</Link><Link href={`/club/shop/balance${query}`}>Balance top-up</Link><Link href={`/club/shop/supplier-catalogue${query}`}>Supplier catalogue</Link><Link href={`/club/shop/supplier-orders${query}`}>Supplier orders</Link><Link href={`/club/shop/collections${query}`}>Collections</Link>{canManage ? <><Link href={`/club/products${query}`}>Products &amp; Pricing</Link><Link href={`/club/promotions${query}`}>Promotions</Link></> : null}</nav>;
}

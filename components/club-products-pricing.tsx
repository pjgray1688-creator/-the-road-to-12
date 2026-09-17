"use client";

import { useMemo, useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import styles from "./club-products-pricing.module.css";

type AlertFilter = "attention" | "margin" | "cost" | "override";

/** Management-only overview. Economics are deliberately absent from member
 * catalogue contracts; this surface is mounted only behind the pricing
 * capability on the Club route. */
export function ClubProductsPricing({ products }: { products: ClubCommerceProduct[] }) {
  const [filter, setFilter] = useState<AlertFilter | "all">("all");
  const alerts = useMemo(() => products.flatMap(product => {
    const missingCost = product.costPriceMinor === undefined;
    const margin = product.costPriceMinor !== undefined && product.sellPriceMinor > 0 ? (product.sellPriceMinor - product.costPriceMinor) / product.sellPriceMinor * 100 : undefined;
    const output: Array<{ product: ClubCommerceProduct; kind: AlertFilter; label: string }> = [];
    if (missingCost) output.push({ product, kind: "cost", label: "Missing cost" });
    if (margin !== undefined && margin < 30) output.push({ product, kind: "margin", label: "Below minimum margin" });
    return output;
  }), [products]);
  const visibleAlerts = filter === "all" ? alerts : alerts.filter(alert => alert.kind === filter || filter === "attention" && alert.kind === "cost");
  return <div className={styles.overview} data-testid="products-pricing-overview">
    <section className="products-pricing-alerts" aria-label="Pricing alerts">
      <div className="section-heading"><div><span className="eyebrow">COMMERCIAL CONTROL</span><h2>Products &amp; Pricing</h2></div><span className="muted">Management view · GBP · Products &amp; Services</span></div>
      <p className="muted">Review the exceptions that need a decision, then open a product to update its retail price and cost evidence.</p>
      <div className={styles.filters} role="tablist" aria-label="Pricing alert filters">
        {(["all", "attention", "margin", "cost"] as const).map(value => <button type="button" key={value} className={filter === value ? "primary" : "secondary"} onClick={() => setFilter(value)}>{value === "all" ? "Needs attention" : value === "margin" ? "Below margin" : value === "cost" ? "Cost changes / missing" : "Other attention"} {value === "all" ? `· ${alerts.length}` : `· ${alerts.filter(alert => alert.kind === value).length}`}</button>)}
      </div>
      {visibleAlerts.length ? <div className="products-pricing-alert-list">{visibleAlerts.map((alert, index) => <div className="club-detail-row" key={`${alert.product.id}-${alert.kind}-${index}`}><span><strong>{alert.label}</strong><small>{alert.product.brand ? `${alert.product.brand} · ` : ""}{alert.product.name}</small></span><button type="button" className="secondary" onClick={() => window.dispatchEvent(new CustomEvent("r12:open-product", { detail: alert.product.id }))}>Review</button></div>)}</div> : <p className="muted">No pricing exceptions need attention.</p>}
    </section>

  </div>;
}

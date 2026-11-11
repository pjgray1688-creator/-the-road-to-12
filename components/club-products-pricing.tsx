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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "issue">("name");
  const [page, setPage] = useState(1);
  const alerts = useMemo(() => products.flatMap(product => {
    const missingCost = product.costPriceMinor === undefined;
    const margin = product.costPriceMinor !== undefined && product.sellPriceMinor > 0 ? (product.sellPriceMinor - product.costPriceMinor) / product.sellPriceMinor * 100 : undefined;
    const output: Array<{ product: ClubCommerceProduct; kind: AlertFilter; label: string }> = [];
    if (missingCost) output.push({ product, kind: "cost", label: "Missing cost" });
    if (margin !== undefined && margin < 30) output.push({ product, kind: "margin", label: "Below minimum margin" });
    return output;
  }), [products]);
  const filteredAlerts = alerts.filter(alert => (filter === "all" || alert.kind === filter || filter === "attention" && alert.kind === "cost") && `${alert.product.name} ${alert.product.brand ?? ""} ${alert.label}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === "name" ? a.product.name.localeCompare(b.product.name) : a.label.localeCompare(b.label) || a.product.name.localeCompare(b.product.name));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filteredAlerts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleAlerts = filteredAlerts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div className={styles.overview} data-testid="products-pricing-overview">
    <section className="products-pricing-alerts" aria-label="Pricing alerts">
      <div className="section-heading"><div><h2>Pricing exceptions</h2></div><span className="muted">{filteredAlerts.length} products</span></div>
      <div className={styles.filters} role="tablist" aria-label="Pricing alert filters">
        {(["all", "cost", "margin"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "primary" : "secondary"} onClick={() => { setFilter(value); setPage(1); }}>{value === "all" ? "All exceptions" : value === "margin" ? "Below margin" : "Missing cost"} · {value === "all" ? alerts.length : alerts.filter(alert => alert.kind === value).length}</button>)}
      </div>
      <div className={styles.exceptionControls}><input className={styles.search} aria-label="Search pricing exceptions" placeholder="Search products" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as typeof sort); setPage(1); }}><option value="name">Product name</option><option value="issue">Exception type</option></select></label></div>
      {visibleAlerts.length ? <div className={styles.tableWrap}><table className={styles.exceptionTable}><thead><tr><th>Product</th><th>Issue</th><th>Retail price</th><th>Review</th></tr></thead><tbody>{visibleAlerts.map((alert, index) => <tr key={`${alert.product.id}-${alert.kind}-${index}`}><td>{alert.product.brand ? `${alert.product.brand} · ` : ""}{alert.product.name}</td><td><span>{alert.label}</span></td><td>£{(alert.product.sellPriceMinor / 100).toFixed(2)}</td><td><button type="button" className="secondary" onClick={() => window.dispatchEvent(new CustomEvent("r12:open-product", { detail: alert.product.id }))}>Review</button></td></tr>)}</tbody></table></div> : <p className="muted">No pricing exceptions match this view.</p>}
      {pageCount > 1 ? <div className={styles.pagination}><button type="button" className="secondary" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" className="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div> : null}
    </section>

  </div>;
}

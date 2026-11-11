"use client";

import { useMemo, useState } from "react";
import { ClubVoidOrder } from "@/components/club-void-order";

type FinanceRow = { id: string; description: string; createdAt: string; status: string; totalMinor: number; paymentRoute?: string; canVoid?: boolean };
const PAGE_SIZE = 20;
function TransactionTable({ title, empty, organisationId, rows, showRoute = false }: { title: string; empty: string; organisationId: string; rows: FinanceRow[]; showRoute?: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: "date" | "status" | "amount"; descending: boolean }>({ key: "date", descending: true });
  const matching = useMemo(() => rows.filter(row => `${row.description} ${row.status} ${row.paymentRoute ?? ""} ${row.createdAt}`.toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB"))).sort((a,b) => {
    const comparison = sort.key === "date" ? a.createdAt.localeCompare(b.createdAt) : sort.key === "amount" ? a.totalMinor - b.totalMinor : a.status.localeCompare(b.status);
    return sort.descending ? -comparison : comparison;
  }), [rows, query, sort]);
  const toggleSort = (key: "date" | "status" | "amount") => setSort(current => ({ key, descending: current.key === key ? !current.descending : key === "date" }));
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return <section className="club-finance-table-section"><div className="club-finance-table-heading"><h2>{title}</h2><label>Search<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Product, status or payment route" /></label></div>{visible.length ? <div className="club-finance-table-wrap"><table><thead><tr><th>Order</th><th><button type="button" onClick={() => toggleSort("date")}>Date{sort.key === "date" ? sort.descending ? " ↓" : " ↑" : ""}</button></th><th><button type="button" onClick={() => toggleSort("status")}>Status{sort.key === "status" ? sort.descending ? " ↓" : " ↑" : ""}</button></th>{showRoute ? <th>Payment route</th> : null}<th><button type="button" onClick={() => toggleSort("amount")}>Total{sort.key === "amount" ? sort.descending ? " ↓" : " ↑" : ""}</button></th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td>{row.description}</td><td>{new Date(row.createdAt).toLocaleString("en-GB")}</td><td>{row.status.replaceAll("_", " ")}</td>{showRoute ? <td>{row.paymentRoute ?? "Not recorded"}</td> : null}<td>£{(row.totalMinor / 100).toFixed(2)}</td><td>{row.canVoid ? <ClubVoidOrder organisationId={organisationId} orderId={row.id} /> : null}</td></tr>)}</tbody></table></div> : <p className="muted">{matching.length ? "No records on this page." : empty}</p>}{pageCount > 1 ? <div className="club-finance-pagination"><button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount} · {matching.length} records</span><button type="button" className="secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}</section>;
}
export function ClubFinanceTransactionTables({ organisationId, sales, attempts, showSales = true, showAttempts = true }: { organisationId: string; sales: FinanceRow[]; attempts: FinanceRow[]; showSales?: boolean; showAttempts?: boolean }) {
  return <div className="club-finance-transaction-tables">{showSales ? <TransactionTable title="Completed transactions" empty="No completed transactions in this period." organisationId={organisationId} rows={sales} showRoute/> : null}{showAttempts ? <TransactionTable title="Checkout attempts" empty="No incomplete or cancelled checkout attempts in this period." organisationId={organisationId} rows={attempts}/> : null}</div>;
}

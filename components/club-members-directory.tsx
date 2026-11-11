"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";
import { clubDirectoryPageCount, compareClubMemberDirectoryRows, matchesClubMemberDirectoryFilters, type ClubDirectoryRow, type ClubDirectorySortField } from "@/lib/club-member-directory";
import styles from "./club-members-directory.module.css";

type DirectoryMember = ClubMemberSummaryRead & { phone?: string };
type ImportedMember = { id: string; displayName: string; email?: string; phone?: string; membershipName?: string; membershipStatus?: string; membershipEndsAt?: string; homeLocation?: { id: string; name: string } };
type SortField = ClubDirectorySortField;
type Props = {
  members: DirectoryMember[];
  organisationId: string;
  customers?: ImportedMember[];
  billingStatusAvailable?: boolean;
  arrearsUserIds?: string[];
  initialQuery?: string;
  initialStatus?: string;
  initialAccess?: string;
  initialHome?: string;
  initialPlan?: string;
  initialSort?: SortField;
  initialDirection?: "asc" | "desc";
  initialPage?: number;
};

const pageSize = 25;
const statusOptions = [
  ["all", "All membership statuses"], ["active", "Active"], ["pending", "Pending"],
  ["inactive", "Paused / suspended"], ["cancelled", "Cancelled"], ["expired", "Expired"], ["arrears", "Arrears"],
] as const;
const labelStatus = (value?: string) => value ? value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()) : "Status unavailable";
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const normaliseStatus = (value?: string) => (value ?? "").toLowerCase();

type Row = ClubDirectoryRow & {
  key: string; id: string; userId?: string; displayName: string; email?: string; phone?: string; plan?: string;
  status?: string; endsAt?: string; homeId?: string; homeName?: string; ref: string; accessState?: string; imported: boolean;
};

export function ClubMembersDirectory({ members, organisationId, customers = [], billingStatusAvailable = false, arrearsUserIds = [], initialQuery = "", initialStatus = "all", initialAccess = "all", initialHome = "all", initialPlan = "all", initialSort = "name", initialDirection = "asc", initialPage = 1 }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [accessFilter, setAccessFilter] = useState(initialAccess);
  const [homeFilter, setHomeFilter] = useState(initialHome);
  const [planFilter, setPlanFilter] = useState(initialPlan);
  const [sortField, setSortField] = useState<SortField>(initialSort);
  const [direction, setDirection] = useState<"asc" | "desc">(initialDirection);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const arrears = useMemo(() => new Set(arrearsUserIds), [arrearsUserIds]);

  const rows = useMemo<Row[]>(() => [
    ...members.map(member => ({
      key: `member:${member.id}`, id: member.customerId ?? member.id, userId: member.userId,
      displayName: member.displayName?.trim() || "Member", email: member.email, phone: member.phone,
      plan: member.membershipName, status: member.membershipStatus, endsAt: member.membershipEndsAt,
      homeId: member.homeLocation?.id, homeName: member.homeLocation?.name,
      ref: (member.customerId ?? member.id).slice(0, 8).toUpperCase(), accessState: member.accessState, imported: false,
    })),
    ...customers.map(customer => ({
      key: `customer:${customer.id}`, id: customer.id, displayName: customer.displayName?.trim() || "Member",
      email: customer.email, phone: customer.phone, plan: customer.membershipName, status: customer.membershipStatus,
      endsAt: customer.membershipEndsAt, homeId: customer.homeLocation?.id, homeName: customer.homeLocation?.name,
      ref: customer.id.slice(0, 8).toUpperCase(), imported: true,
    })),
  ], [members, customers]);

  const homes = useMemo(() => [...new Map(rows.filter(row => row.homeId && row.homeName).map(row => [row.homeId!, row.homeName!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const plans = useMemo(() => [...new Set(rows.map(row => row.plan).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)), [rows]);

  const filtered = useMemo(() => {
    return rows.filter(row => {
      return matchesClubMemberDirectoryFilters(row, { query, status: statusFilter, access: accessFilter, home: homeFilter, plan: planFilter, arrearsUserIds: arrears });
    }).sort((a, b) => compareClubMemberDirectoryRows(a, b, sortField, direction));
  }, [rows, query, statusFilter, accessFilter, homeFilter, planFilter, sortField, direction, arrears]);

  const pageCount = clubDirectoryPageCount(filtered.length, pageSize);
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const makeReturnTo = () => {
    const params = new URLSearchParams({ org: organisationId });
    if (query) params.set("q", query);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (accessFilter !== "all") params.set("access", accessFilter);
    if (homeFilter !== "all") params.set("home", homeFilter);
    if (planFilter !== "all") params.set("plan", planFilter);
    if (sortField !== "name") params.set("sort", sortField);
    if (direction !== "asc") params.set("dir", direction);
    if (safePage > 1) params.set("page", String(safePage));
    return `/club/members?${params.toString()}`;
  };
  const rowHref = (row: Row) => {
    const base = row.imported || !row.userId
      ? `/club/members/customer/${encodeURIComponent(row.id)}`
      : `/club/members/${encodeURIComponent(row.userId)}`;
    return `${base}?org=${encodeURIComponent(organisationId)}&returnTo=${encodeURIComponent(makeReturnTo())}`;
  };

  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setPage(1); }
  function sortBy(field: SortField) { if (sortField === field) setDirection(value => value === "asc" ? "desc" : "asc"); else { setSortField(field); setDirection("asc"); } setPage(1); }
  const sortButton = (field: SortField, label: string) => <button type="button" onClick={() => sortBy(field)} aria-label={`Sort by ${label}`} aria-pressed={sortField === field}>{label}<span aria-hidden="true">{sortField === field ? direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button>;
  const personHref = (row: Row) => rowHref(row);

  return <div className={styles.directory}>
    <div className={styles.filters}>
      <label className={styles.searchField}><span className="sr-only">Search name, email, phone or member reference</span><input type="search" placeholder="Search name, email, phone or reference" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label><span className="sr-only">Filter membership status</span><select aria-label="Filter membership status" value={statusFilter} onChange={event => changeFilter(setStatusFilter, event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value} disabled={value === "arrears" && !billingStatusAvailable}>{value === "arrears" && !billingStatusAvailable ? "Arrears (data unavailable)" : label}</option>)}</select></label>
      <label><span className="sr-only">Filter home gym</span><select aria-label="Filter home gym" value={homeFilter} onChange={event => changeFilter(setHomeFilter, event.target.value)}><option value="all">All home gyms</option>{homes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span className="sr-only">Filter membership plan</span><select aria-label="Filter membership plan" value={planFilter} onChange={event => changeFilter(setPlanFilter, event.target.value)}><option value="all">All membership plans</option>{plans.map(plan => <option key={plan} value={plan}>{plan}</option>)}</select></label>
    </div>
    <div className={styles.mobileFilters}>
      <label className={styles.mobileSearch}><span className="sr-only">Search by name or email</span><input type="search" aria-label="Search by name or email" placeholder="Search by name or email" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label><span className="sr-only">Filter access</span><select aria-label="Filter access" value={accessFilter} onChange={event => changeFilter(setAccessFilter, event.target.value)}><option value="all">All access</option><option value="active">Access active</option><option value="needs_attention">Needs attention</option><option value="unavailable">Access unavailable</option></select></label>
      <label><span className="sr-only">Filter membership</span><select aria-label="Filter membership" value={statusFilter} onChange={event => changeFilter(setStatusFilter, event.target.value)}><option value="all">All membership history</option>{[...new Set(rows.map(row => row.status).filter((value): value is string => Boolean(value)))].sort().map(value => <option value={value} key={value}>{labelStatus(value)}</option>)}</select></label>
    </div>
    <div className={styles.resultSummary}><strong>{filtered.length.toLocaleString("en-GB")}</strong><span>{filtered.length === 1 ? "membership record" : "membership records"}</span><span className={styles.mobilePeople}>{filtered.length.toLocaleString("en-GB")} {filtered.length === 1 ? "person" : "people"}</span><span className={`${styles.dataNote} club-member-history-note`}>Only people with membership history appear here.</span></div>
    {filtered.length ? <>
      <div className={styles.desktopTableWrap}>
        <table className={styles.table}>
          <thead><tr><th scope="col">{sortButton("name", "Member")}</th><th scope="col">{sortButton("home", "Home gym")}</th><th scope="col">{sortButton("plan", "Membership")}</th><th scope="col">{sortButton("status", "Status")}</th><th scope="col">Payment</th><th scope="col">{sortButton("ends", "Renewal / expiry")}</th><th scope="col">Last attendance</th></tr></thead>
          <tbody>{pageRows.map(row => {
            const overdue = row.userId ? arrears.has(row.userId) : false;
            return <tr key={row.key} onClick={() => router.push(personHref(row))}>
              <td><a className={styles.member} href={personHref(row)} onClick={event => event.stopPropagation()}><span className={styles.avatar} aria-hidden="true">{row.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{row.displayName}</strong><small>{row.email ?? row.phone ?? "Contact details unavailable"}</small><small className={styles.reference}>Ref {row.ref}</small></span></a></td>
              <td>{row.homeName ?? <span className={styles.notRecorded}>Not recorded</span>}</td>
              <td>{row.plan ?? <span className={styles.notRecorded}>Membership history</span>}</td>
              <td><span className={styles.status} data-state={normaliseStatus(row.status)}>{labelStatus(row.status)}</span></td>
              <td>{billingStatusAvailable ? overdue ? <span className={styles.paymentFlag}>Arrears</span> : <span className={styles.paymentClear}>No open arrears</span> : <span className={styles.notRecorded} title="Payment detail is not available for this role or account">Not available</span>}</td>
              <td>{formatDate(row.endsAt)}</td>
              <td><span className={styles.notRecorded} title="Last attendance is not included in the directory data">—</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className={styles.mobileList}>
        {pageRows.map(row => <a className={styles.mobileRow} key={row.key} href={personHref(row)}><span className={styles.avatar} aria-hidden="true">{row.displayName.slice(0, 1).toUpperCase()}</span><span className={styles.mobileMain}><strong>{row.displayName}</strong><small>{row.email ?? row.phone ?? "R12 account"}</small><small>{row.plan ?? "Gym membership"} · {labelStatus(row.status)}{row.endsAt ? ` · ${formatDate(row.endsAt)}` : ""}{row.homeName ? ` · Home: ${row.homeName}` : ""}</small><em data-state={row.accessState ?? "unavailable"}>{row.accessState === "active" ? "Access active" : row.accessState === "needs_attention" ? "Needs attention" : "Access unavailable"}</em></span><b aria-hidden="true">›</b></a>)}
      </div>
      <div className={styles.pagination}><span>Showing {((safePage - 1) * pageSize + 1).toLocaleString("en-GB")}–{Math.min(safePage * pageSize, filtered.length).toLocaleString("en-GB")} of {filtered.length.toLocaleString("en-GB")}</span><div><button type="button" disabled={safePage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {safePage} of {pageCount}</span><button type="button" disabled={safePage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next</button></div></div>
    </> : <p className={styles.empty}>{query || statusFilter !== "all" || accessFilter !== "all" || homeFilter !== "all" || planFilter !== "all" ? "No membership records match these filters." : "No membership records yet."}</p>}
  </div>;
}

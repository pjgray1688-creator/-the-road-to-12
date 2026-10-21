"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordClassCashAction, reconcileClassDropBoxCashAction, updateClassAttendanceAction } from "@/app/club/classes/actions";
import { cancelMemberClassAction } from "@/app/club/classes/member-actions";

type RosterItem = { bookingId: string; customerId: string; memberName: string; status: string; attendanceState: string; paymentMethod: string | null; paymentStatus: string; amountMinor: number | null; cashStatus: string | null; cashDue: number; cancelledAt: string | null };
type MemberChoice = { id: string; name: string };
const cashText = (method: string | null, status: string, amount: number | null) => {
  if (method === "transformation_credit") return "Included transformation class";
  if (method === "class_credit") return "Paid class credit";
  if (method === "stripe") return status === "paid" ? "Stripe paid £10" : "Stripe payment pending";
  if (method === "gym_drop_box") return status === "paid" ? "Drop box verified £10" : "£10 cash due · gym drop box";
  if (method === "staff_cash") return "Staff collected cash £10";
  return "Payment status unavailable";
};

export function ClubClassRegister({ sessionId, capacity, reserved, roster, members, canCollectCash, canReconcileCash }: { sessionId: string; capacity: number; reserved: number; roster: RosterItem[]; members: MemberChoice[]; canCollectCash: boolean; canReconcileCash: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState(""); const [customerId, setCustomerId] = useState(members[0]?.id ?? ""); const [references, setReferences] = useState<Record<string, string>>({});
  const action = (run: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { setMessage(""); const result = await run(); if (!result.ok) { setMessage(result.error ?? "The update could not be saved."); return; } router.refresh(); });
  return <section className="club-class-register">
    <h2>Class register</h2><p>{reserved} of {capacity} spaces reserved · {Math.max(0, capacity - reserved)} remaining</p>
    {message && <p className="error-text" role="alert">{message}</p>}
    {canCollectCash && <div className="club-detail-row"><label>Collect £10 cash for a member booking<select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Choose active member</option>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><button type="button" disabled={pending || !customerId || reserved >= capacity} onClick={() => action(async () => { const result = await recordClassCashAction({ sessionId, customerId }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>Take cash and book</button></div>}
    {roster.length ? <div className="club-detail-list">{roster.map(item => <article className="club-detail-row" key={item.bookingId}><div><strong>{item.memberName}</strong><small>{item.status} · {cashText(item.paymentMethod, item.paymentStatus, item.amountMinor)} · Attendance: {item.attendanceState}</small>{item.cashDue > 0 && <small>£{(item.cashDue / 100).toFixed(2)} CASH DUE</small>}{item.cancelledAt && <small>Cancelled {new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.cancelledAt))}</small>}</div><div className="member-class-action">{canCollectCash && item.status === "cash_due" && <button type="button" disabled={pending} onClick={() => action(async () => { const result = await recordClassCashAction({ sessionId, customerId: item.customerId, bookingId: item.bookingId }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>Cash received</button>}{canReconcileCash && item.status === "cash_due" && item.paymentMethod === "gym_drop_box" && <><input aria-label={`Drop-box reconciliation reference for ${item.memberName}`} maxLength={120} placeholder="Enter physical cash reference" value={references[item.bookingId] ?? ""} onChange={event => setReferences(current => ({ ...current, [item.bookingId]: event.target.value }))} /><button type="button" disabled={pending || !references[item.bookingId]?.trim()} onClick={() => action(async () => { const result = await reconcileClassDropBoxCashAction({ bookingId: item.bookingId, reference: references[item.bookingId].trim() }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>Verify drop-box cash</button></>}{item.status !== "cancelled" && <button type="button" disabled={pending} onClick={() => action(async () => { const result = await updateClassAttendanceAction({ bookingId: item.bookingId, sessionId, attendanceState: "attended" }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>Attended</button>}{item.status !== "cancelled" && <button type="button" disabled={pending} onClick={() => action(async () => { const result = await updateClassAttendanceAction({ bookingId: item.bookingId, sessionId, attendanceState: "no_show" }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>No-show</button>}{item.status !== "cancelled" && <button type="button" disabled={pending} onClick={() => action(async () => { const result = await cancelMemberClassAction({ bookingId: item.bookingId }); return result.ok ? { ok: true } : { ok: false, error: result.error }; })}>Cancel</button>}</div></article>)}</div> : <p className="muted">No bookings yet.</p>}
  </section>;
}

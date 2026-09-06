"use client";
import { useState, useTransition } from "react";
import { cancelStaffPendingOrderAction } from "@/app/club/shop/actions";
export function ClubVoidOrder({ organisationId, orderId }: { organisationId: string; orderId: string }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState<string>();
  return <span><button type="button" className="secondary" disabled={pending} onClick={() => { if (!window.confirm("Void this abandoned checkout?")) return; start(async () => { const result = await cancelStaffPendingOrderAction({ organisationId, orderId }); setMessage(result.ok ? "Voided" : result.error); }); }}>{pending ? "Voiding…" : message ?? "Void checkout"}</button></span>;
}

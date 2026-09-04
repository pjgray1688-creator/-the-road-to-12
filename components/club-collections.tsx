"use client";
import { useState, useTransition } from "react";
import { confirmCollectionAction } from "@/app/club/shop/collections/actions";

export function ClubCollections({ organisationId, collections }: { organisationId: string; collections: Array<Record<string, unknown>> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  return <section aria-label="Ready for collection"><div className="club-catalogue-list">{collections.map(item => <article className="club-catalogue-row" key={String(item.order_id)}><div><strong>{String(item.member_name ?? "Member")} · {String(item.order_reference ?? "Order")}</strong><small>{String(item.collection_location ?? "Collection desk")} · ready {new Date(String(item.ready_at)).toLocaleString("en-GB")}</small><span>{String(item.items_summary ?? "Items ready")}</span></div><button type="button" className="primary" disabled={pending} onClick={() => { if (!window.confirm("Confirm this member has collected the order?")) return; startTransition(async () => { const result = await confirmCollectionAction(organisationId, String(item.order_id)); setMessage(result.ok ? "Collection recorded." : result.error); }); }}>Confirm collected</button></article>)}</div>{message ? <p role="status">{message}</p> : null}</section>;
}

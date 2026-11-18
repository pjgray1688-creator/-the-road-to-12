"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClubProduct, FixedTermUnit } from "@/lib/club";
import { saveFixedTermMembershipProductAction } from "@/app/club/memberships/actions";
import styles from "./club-fixed-term-membership-products.module.css";

export function ClubFixedTermMembershipProducts({ organisationId, products }: { organisationId: string; products: ClubProduct[] }) {
  const router = useRouter();
  const fixed = products.filter(product => product.kind === "membership" && product.fixedTermValue && product.fixedTermUnit && !product.archivedAt);
  const [selectedId, setSelectedId] = useState("");
  const selected = fixed.find(product => product.id === selectedId);
  const [name, setName] = useState(selected?.name ?? "");
  const [price, setPrice] = useState(selected ? (selected.priceMinor / 100).toFixed(2) : "");
  const [durationValue, setDurationValue] = useState(selected?.fixedTermValue ?? 3);
  const [durationUnit, setDurationUnit] = useState<FixedTermUnit>(selected?.fixedTermUnit ?? "month");
  const [joiningFee, setJoiningFee] = useState("");
  const [sellable, setSellable] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function select(value: string) {
    setSelectedId(value);
    const product = fixed.find(item => item.id === value);
    setName(product?.name ?? "");
    setPrice(product ? (product.priceMinor / 100).toFixed(2) : "");
    setDurationValue(product?.fixedTermValue ?? 3);
    setDurationUnit(product?.fixedTermUnit ?? "month");
    setSellable(product?.sellable ?? false);
    setJoiningFee("");
    setMessage(undefined);
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveFixedTermMembershipProductAction({ organisationId, ...(selectedId ? { productId: selectedId } : {}), name, price, durationValue, durationUnit, sellable, joiningFee });
      setMessage(result.ok ? "Fixed-term product saved. Existing memberships keep their recorded dates." : result.error);
      if (result.ok) { setSelectedId(""); setName(""); setPrice(""); setDurationValue(3); setDurationUnit("month"); setJoiningFee(""); setSellable(false); router.refresh(); }
    });
  }

  return <section aria-labelledby="fixed-term-products-title" className={styles.section}>
    <h2 id="fixed-term-products-title">Fixed-term memberships</h2>
    <p className="muted">Configure non-recurring membership offers for imports, staff assignment and prepaid purchases. Terms never create a subscription or mandate.</p>
    <label>Product to edit<select value={selectedId} onChange={event => select(event.target.value)}><option value="">Create a fixed-term product</option>{fixed.map(product => <option key={product.id} value={product.id}>{product.name} · {product.fixedTermValue} {product.fixedTermUnit}{product.fixedTermValue === 1 ? "" : "s"}</option>)}</select></label>
    <form onSubmit={save} className={styles.form}>
      <label>Product name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Price (GBP)<input required inputMode="decimal" placeholder="50.00" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label>Term length<input required type="number" min={1} max={1200} step={1} value={durationValue} onChange={event => setDurationValue(Number(event.target.value))} /></label>
      <label>Term unit<select value={durationUnit} onChange={event => setDurationUnit(event.target.value as FixedTermUnit)}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Calendar months</option></select></label>
      <label>Optional joining fee (GBP)<input inputMode="decimal" placeholder="Leave blank to keep current / no fee" value={joiningFee} onChange={event => setJoiningFee(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={sellable} onChange={event => setSellable(event.target.checked)} />Available for public purchase</label>
      <p className="muted">Gym access follows the product’s configured entitlement. Optional joining fees use the existing joining-fee charge and promotion rules. When editing, leave the fee blank to keep it; enter 0 to disable it. Imported and complimentary/prepaid assignments do not charge.</p>
      <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : selectedId ? "Save fixed-term product" : "Create fixed-term product"}</button>
    </form>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}

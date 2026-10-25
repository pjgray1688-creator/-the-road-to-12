"use client";

import { useMemo, useState } from "react";
import { GLOW_PAYG_MAX_MINUTES, GLOW_PAYG_PRICE_MINOR, glowBasketTotal, normaliseGlowPaygMinutes } from "@/lib/glow-zone-basket";

type GlowPackage = { id: string; name: string; minutes: number; priceMinor: number };
type BasketLine = { id: string; label: string; quantity: number; priceMinor: number; payg: boolean };
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function GlowZoneBasket({ packages, demo = false }: { packages: GlowPackage[]; demo?: boolean }) {
  const [selected, setSelected] = useState(packages[0]?.id ?? "payg");
  const [paygMinutes, setPaygMinutes] = useState(5);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const total = useMemo(() => glowBasketTotal(lines), [lines]);

  function addSelected() {
    const item = packages.find(candidate => candidate.id === selected);
    const addition: BasketLine = item
      ? { id: item.id, label: `${item.minutes} minute package`, quantity: 1, priceMinor: item.priceMinor, payg: false }
      : { id: "payg", label: "Pay as you go", quantity: normaliseGlowPaygMinutes(paygMinutes), priceMinor: GLOW_PAYG_PRICE_MINOR, payg: true };
    setLines(current => {
      const existing = current.find(line => line.id === addition.id);
      if (!existing) return [...current, addition];
      return current.map(line => line.id === addition.id ? { ...line, quantity: line.quantity + addition.quantity } : line);
    });
  }

  function change(id: string, delta: number) {
    setLines(current => current
      .map(line => line.id === id ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line)
      .filter(line => line.quantity > 0));
  }

  return <>
    <section className="surface-card glow-purchase-card">
      <div className="glow-section-heading"><div><span className="eyebrow">Choose minutes</span><h2>Minute packages</h2></div><span>{demo ? "Standard prices" : "Your price"}</span></div>
      <div className="glow-package-options" role="radiogroup" aria-label="Minute package">
        {packages.map(item => <button key={item.id} type="button" role="radio" aria-checked={selected === item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)}>
          <strong>{item.minutes}<small> min</small></strong><span>{money.format(item.priceMinor / 100)}</span>
        </button>)}
        <button type="button" role="radio" aria-checked={selected === "payg"} className={selected === "payg" ? "selected" : ""} onClick={() => setSelected("payg")}>
          <strong>PAYG</strong><span>£1 / min</span>
        </button>
      </div>
      {selected === "payg" ? <label className="glow-payg-input">Number of minutes
        <input type="number" inputMode="numeric" min="1" max={GLOW_PAYG_MAX_MINUTES} value={paygMinutes} onChange={event => setPaygMinutes(normaliseGlowPaygMinutes(event.target.value))} />
      </label> : null}
      <button className="primary full" type="button" onClick={addSelected}>Add to basket</button>
    </section>

    <section className="surface-card glow-basket-card" aria-live="polite">
      <div className="glow-section-heading"><div><span className="eyebrow">Your basket</span><h2>{lines.length ? `${lines.length} item${lines.length === 1 ? "" : "s"}` : "Nothing added yet"}</h2></div></div>
      {lines.map(line => <div className="glow-basket-line" key={line.id}>
        <div><strong>{line.label}</strong><small>{line.payg ? `${line.quantity} minute${line.quantity === 1 ? "" : "s"}` : `${line.quantity} × ${money.format(line.priceMinor / 100)}`}</small></div>
        <strong>{money.format(line.quantity * line.priceMinor / 100)}</strong>
        <div className="glow-quantity-control" aria-label={`${line.label} quantity`}>
          <button type="button" aria-label={`Reduce ${line.label}`} onClick={() => change(line.id, -1)}>−</button>
          <span>{line.quantity}</span>
          <button type="button" aria-label={`Increase ${line.label}`} onClick={() => change(line.id, 1)}>+</button>
          <button type="button" className="glow-remove" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>Remove</button>
        </div>
      </div>)}
      <div className="glow-basket-total"><span>Total</span><strong>{money.format(total / 100)}</strong></div>
      <button className="glow-checkout-soon" type="button" disabled>Pay by card — Coming soon</button>
      <p className="muted">{demo ? "This demonstration cannot take payment or add minutes." : "Cash payments are available at Carlton reception. Minutes are added only after staff confirm payment."}</p>
    </section>
  </>;
}

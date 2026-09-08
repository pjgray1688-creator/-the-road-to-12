"use client";
import { useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import { availableVariantOptions, resolveProductVariant, type FamilyCard } from "@/lib/club-product-families";
import styles from "./club-shop.module.css";
import { ClubProductMedia, sharedProductImage } from "./club-product-media";
import { memberAvailabilityLabel, type MemberAvailabilityState } from "@/lib/club-member-availability";
type Props = { add: (product: ClubCommerceProduct) => void; cards: FamilyCard[]; availability?: Record<string, MemberAvailabilityState> };
const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
const CartIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></svg>;
export function ClubMemberShop({ add, cards, availability = {} }: Props) {
  const [picked, setPicked] = useState<FamilyCard>(); const [selection, setSelection] = useState<Record<string,string>>({});
  const open = (card: FamilyCard) => { setPicked(card); setSelection(card.variants.length === 1 ? Object.fromEntries(Object.entries(card.variants[0].variantOptions ?? {})) : {}); };
  const options = picked ? availableVariantOptions(picked.variants, selection) : {}; const resolved = picked ? resolveProductVariant(picked.variants, selection) : undefined; const detailImage = resolved?.variantImageReference ? { ...resolved, media: { url: resolved.variantImageReference } } : picked?.variants[0];
  const stateFor = (product?: ClubCommerceProduct): MemberAvailabilityState => product ? (availability[product.id] ?? "UNAVAILABLE") : "UNAVAILABLE";
  return <>
    <div className={styles.productGrid}>{cards.map(card => { const single = card.variants.length === 1; const state: MemberAvailabilityState = single ? stateFor(card.variants[0]) : "UNAVAILABLE"; return <article className={styles.product} key={card.family?.id ?? card.variants[0].id}>
      <button type="button" className={styles.productSelect} onClick={() => open(card)} aria-label={`View details for ${card.label}`}>
        {sharedProductImage(card.variants) ? <ClubProductMedia product={card.variants[0]} className="club-product-thumb" /> : <div className="club-product-placeholder" aria-hidden="true">R12</div>}
        <strong>{card.label}</strong>{card.family?.brand ? <small>{card.family.brand}</small> : null}<span>{card.priceLabel}</span><small>{single ? memberAvailabilityLabel(state) : `${card.variants.length} variants`}</small>
      </button>
      <button type="button" className="secondary" disabled={single && state === "UNAVAILABLE"} onClick={() => single ? add(card.variants[0]) : open(card)}><CartIcon /> {single ? "Add" : "Choose options"}</button>
    </article>; })}</div>
    {picked ? <div className="modal" role="dialog" aria-modal="true" aria-label={`${picked.label} details`}><div className={styles.sheet}><div className={styles.sheetHead}><div><span className="eyebrow">PRODUCT DETAILS</span><h2>{picked.label}</h2><p>{picked.priceLabel}</p></div><button type="button" className="text-button" onClick={() => setPicked(undefined)}>Close</button></div>{detailImage && sharedProductImage(picked.variants) ? <ClubProductMedia product={detailImage} className="club-product-thumb" /> : detailImage && resolved?.variantImageReference ? <ClubProductMedia product={detailImage} className="club-product-thumb" /> : <div className="club-product-placeholder" aria-hidden="true">R12</div>}{Object.entries(options).map(([key, values]) => <label key={key}>{key}<select value={selection[key] ?? ""} onChange={event => setSelection(current => ({ ...current, [key]: event.target.value }))}><option value="">Choose…</option>{values.map(value => <option value={value} key={value}>{value}</option>)}</select></label>)}{resolved ? <p>{resolved.description ?? ""}</p> : <p>Select each option to choose an available variant.</p>}<p className="hint">{memberAvailabilityLabel(stateFor(resolved))}</p><button type="button" className="primary full" disabled={!resolved || stateFor(resolved) === "UNAVAILABLE"} onClick={() => { if (resolved) { add(resolved); setPicked(undefined); setSelection({}); } }}>Add to basket</button></div></div> : null}
  </>;
}

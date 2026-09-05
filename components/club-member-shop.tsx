"use client";
import { useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import { availableVariantOptions, resolveProductVariant, type FamilyCard } from "@/lib/club-product-families";
import styles from "./club-shop.module.css";
import { ClubProductMedia, sharedProductImage } from "./club-product-media";

type Props = { add: (product: ClubCommerceProduct) => void; cards: FamilyCard[] };
const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
export function ClubMemberShop({ add, cards }: Props) {
  const [picked, setPicked] = useState<FamilyCard>(); const [selection, setSelection] = useState<Record<string, string>>({});
  const open = (card: FamilyCard) => { if (!card.family || card.variants.length === 1) { add(card.variants[0]); return; } setPicked(card); setSelection({}); };
  const options = picked ? availableVariantOptions(picked.variants, selection) : {}; const resolved = picked ? resolveProductVariant(picked.variants, selection) : undefined;
  return <><div className={styles.productGrid}>{cards.map(card => <article className={styles.product} key={card.family?.id ?? card.variants[0].id}>{sharedProductImage(card.variants) ? <ClubProductMedia product={card.variants[0]} className="club-product-thumb" /> : null}<button type="button" className={styles.product} onClick={() => open(card)}><strong>{card.label}</strong>{card.family?.brand ? <small>{card.family.brand}</small> : null}<span>{card.priceLabel}</span><small>{card.variants.length} variant{card.variants.length === 1 ? "" : "s"}</small></button>{card.family && card.variants.length > 1 ? <button type="button" className="secondary" onClick={() => open(card)}>Choose options</button> : <button type="button" className="secondary" onClick={() => add(card.variants[0])}>Add to basket</button>}</article>)}</div>{picked ? <div className="modal" role="dialog" aria-modal="true"><div className={styles.sheet}><div className={styles.sheetHead}><div><span className="eyebrow">CHOOSE VARIANT</span><h2>{picked.label}</h2><p>{picked.priceLabel}</p></div><button type="button" className="text-button" onClick={() => setPicked(undefined)}>Close</button></div>{Object.entries(options).map(([key, values]) => <label key={key}>{key}<select value={selection[key] ?? ""} onChange={event => setSelection(current => ({ ...current, [key]: event.target.value }))}><option value="">Choose…</option>{values.map(value => <option value={value} key={value}>{value}</option>)}</select></label>)}{resolved ? <p>Selected variant · {money(resolved.sellPriceMinor)}{resolved.sku ? ` · SKU ${resolved.sku}` : ""}</p> : <p>Select each option to choose an available variant.</p>}{resolved ? <ClubProductMedia product={resolved} className="club-product-thumb" /> : null}<button type="button" className="primary full" disabled={!resolved} onClick={() => { if (resolved) { add(resolved); setPicked(undefined); setSelection({}); } }}>Add selected variant</button></div></div> : null}</>;
}

"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { saveWebsiteShopFamilyVisibility, saveWebsiteShopSettings } from "@/app/club/website-shop/actions";
import type { WebsiteShopSlug } from "@/lib/madhouse-website-shop-mappings";
import styles from "./club-website-shop.module.css";

export type WebsiteShopRow = {
  slug: WebsiteShopSlug;
  name: string;
  colour: string;
  kind: "tee" | "hoodie" | "sweatshirt";
  frontImage: string;
  familyId: string;
  defaultPriceMinor: number | null;
  priceOverrideMinor: number | null;
  visible: boolean;
  catalogueSizes: string[];
  enabledSizes: string[];
};

type ShopFamily = { id: string; kind: WebsiteShopRow["kind"]; title: string; defaultPriceMinor: number; visible: boolean };
type Draft = { price: string; visible: boolean; sizes: string[] };
const money = (minor: number | null) => minor === null ? "Price unavailable" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

export function ClubWebsiteShop({ organisationId, rows, families }: { organisationId: string; rows: WebsiteShopRow[]; families: ShopFamily[] }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map(row => [row.slug, {
    price: row.priceOverrideMinor === null ? "" : (row.priceOverrideMinor / 100).toFixed(2),
    visible: row.visible,
    sizes: row.enabledSizes,
  }])));
  const [familyState, setFamilyState] = useState<Record<string, boolean>>(() => Object.fromEntries(families.map(family => [family.id, family.visible])));
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [savingFamily, setSavingFamily] = useState<string | null>(null);
  const setDraft = (slug: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [slug]: { ...current[slug], ...patch } }));
  const currentVisibleCount = rows.filter(row => drafts[row.slug]?.visible && drafts[row.slug]?.sizes.length > 0 && familyState[row.familyId]).length;

  function save(row: WebsiteShopRow) {
    const draft = drafts[row.slug];
    const parsed = draft.price.trim() === "" ? null : Math.round(Number(draft.price) * 100);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed <= 0)) {
      setMessages(current => ({ ...current, [row.slug]: "Enter a valid price, or use the standard price." }));
      return;
    }
    setMessages(current => ({ ...current, [row.slug]: "Saving…" }));
    startTransition(async () => {
      const result = await saveWebsiteShopSettings({ organisationId, slug: row.slug, priceMinor: parsed, visible: draft.visible, sizes: draft.sizes });
      setMessages(current => ({ ...current, [row.slug]: result.ok ? "Saved" : result.error }));
    });
  }

  function toggleFamily(family: ShopFamily) {
    const visible = !familyState[family.id];
    setSavingFamily(family.id);
    startTransition(async () => {
      const result = await saveWebsiteShopFamilyVisibility({ organisationId, familyId: family.id, visible });
      if (result.ok) setFamilyState(current => ({ ...current, [family.id]: visible }));
      setMessages(current => ({ ...current, [`family:${family.id}`]: result.ok ? (visible ? "Family is visible on the website." : "Family is hidden from the website.") : result.error }));
      setSavingFamily(null);
    });
  }

  return <section className={styles.workspace} aria-label="Madhouse Apparel website shop management">
    <header className={styles.summary}>
      <div><span className={styles.eyebrow}>MADE TO ORDER</span><h2>Website Shop</h2><p>Changes here affect public website prices and availability. Member-shop prices stay as they are.</p></div>
      <div className={styles.summaryCounts}><strong>{currentVisibleCount} <small>visible</small></strong><span>{rows.length - currentVisibleCount} hidden</span></div>
    </header>
    {families.map(family => {
      const familyRows = rows.filter(row => row.familyId === family.id);
      const visible = familyState[family.id];
      return <section key={family.id} className={styles.family} aria-labelledby={`family-${family.kind}`}>
        <header className={styles.familyHead}>
          <div><span className={styles.eyebrow}>STANDARD PRICE · {money(family.defaultPriceMinor)}</span><h2 id={`family-${family.kind}`}>{family.title}</h2><p>{familyRows.length} colourways</p></div>
          <div className={styles.familyControl}><span>{visible ? "Visible" : "Hidden"}</span><button type="button" role="switch" aria-checked={visible} aria-label={`${visible ? "Hide" : "Show"} all ${family.title}`} onClick={() => toggleFamily(family)} disabled={savingFamily === family.id}>{visible ? "Hide family" : "Show family"}</button></div>
        </header>
        {messages[`family:${family.id}`] && <p className={styles.feedback} role="status">{messages[`family:${family.id}`]}</p>}
        <div className={styles.colourways}>
          {familyRows.map(row => {
            const draft = drafts[row.slug];
            const effectivePrice = draft.price.trim() ? Math.round(Number(draft.price) * 100) : row.defaultPriceMinor;
            return <article key={row.slug} className={styles.colourway}>
              <div className={styles.productIdentity}><Image src={row.frontImage} width={66} height={78} alt="" /><div><h3>{row.name}</h3><p>{row.colour}</p><span>Website price <b>{money(effectivePrice)}</b></span></div></div>
              <label className={styles.priceField}>Price override <span>£</span><input aria-label={`${row.colour} website price override`} inputMode="decimal" type="number" min="0.01" step="0.01" placeholder={money(row.defaultPriceMinor)} value={draft.price} onChange={event => setDraft(row.slug, { price: event.target.value })} /><button type="button" onClick={() => setDraft(row.slug, { price: "" })} disabled={!draft.price}>Use standard price</button></label>
              <div className={styles.visibility}><span>{draft.visible ? "Visible" : "Hidden"}</span><button type="button" role="switch" aria-checked={draft.visible} aria-label={`${draft.visible ? "Hide" : "Show"} ${row.colour}`} onClick={() => setDraft(row.slug, { visible: !draft.visible })}><i /></button></div>
              <fieldset className={styles.sizes}><legend>Available sizes</legend><div>{["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"].map(size => {
                const inCatalogue = row.catalogueSizes.includes(size);
                const enabled = draft.sizes.includes(size);
                return <label key={size} className={!inCatalogue ? styles.unavailableSize : ""}><input type="checkbox" checked={enabled} disabled={!inCatalogue} onChange={() => setDraft(row.slug, { sizes: enabled ? draft.sizes.filter(item => item !== size) : [...draft.sizes, size] })} /><span>{size}</span></label>;
              })}</div>{row.catalogueSizes.length === 0 && <small className={styles.feedback}>No active catalogue sizes are currently available.</small>}{draft.sizes.length === 0 && <small className={styles.feedback}>No sizes selected; this colourway will be hidden from customers.</small>}</fieldset>
              <div className={styles.saveRow}><button type="button" onClick={() => save(row)} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><span className={styles.feedback} role="status">{messages[row.slug] ?? ""}</span></div>
            </article>;
          })}
        </div>
      </section>;
    })}
  </section>;
}

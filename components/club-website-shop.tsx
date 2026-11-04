"use client";

import { useState, useTransition } from "react";
import { saveWebsiteShopPublication } from "@/app/club/website-shop/actions";
import type { WebsiteShopProposal, WebsiteShopSlug } from "@/lib/madhouse-website-shop-mappings";
import styles from "./club-website-shop.module.css";

export type WebsiteShopChoice = {
  key: string;
  familyId: string;
  familyName: string;
  variantColour: string;
  sizes: string[];
  defaultPriceMinor: number | null;
  eligible: boolean;
};

export type WebsiteShopRow = {
  slug: string;
  name: string;
  colour: string;
  kind: "tee" | "hoodie" | "sweatshirt";
  frontImage: string;
  backImage: string | null;
  publication?: {
    familyId: string;
    variantColour: string;
    priceMinor: number | null;
    published: boolean;
    available: boolean;
    mappingVerified: boolean;
    frontImage: string;
    backImage: string | null;
  };
};

export function ClubWebsiteShop({ organisationId, rows, choices, proposals }: { organisationId: string; rows: WebsiteShopRow[]; choices: WebsiteShopChoice[]; proposals: Readonly<Record<WebsiteShopSlug, WebsiteShopProposal>> }) {
  const [saved, setSaved] = useState<Record<string, WebsiteShopRow["publication"]>>(
    Object.fromEntries(rows.filter(row => row.publication).map(row => [row.slug, row.publication])),
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const choiceLabel = (choice: WebsiteShopChoice) => `${choice.familyName} · ${choice.variantColour}${choice.sizes.length ? ` · ${choice.sizes.join(", ")}` : " · No active sizes"}${choice.defaultPriceMinor == null ? " · No uniform catalogue price" : ` · R12 ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(choice.defaultPriceMinor / 100)}`}${choice.eligible ? "" : " · Inactive family (unpublish only)"}`;
  const clearMappingConfirmation = (form: HTMLFormElement | null) => {
    const confirmation = form?.elements.namedItem("mappingVerified");
    if (confirmation instanceof HTMLInputElement) confirmation.checked = false;
  };
  const previewItems = rows.flatMap(row => {
    const publication = saved[row.slug];
    if (!publication?.published || !publication.available || !publication.mappingVerified) return [];
    const choice = choices.find(item => item.familyId === publication.familyId && item.variantColour === publication.variantColour);
    const priceMinor = publication.priceMinor ?? choice?.defaultPriceMinor ?? null;
    if (!choice || choice.sizes.length !== 8 || priceMinor === null || priceMinor <= 0) return [];
    return [{ row, choice, priceMinor }];
  });

  function save(row: WebsiteShopRow, form: HTMLFormElement) {
    const data = new FormData(form);
    const choice = choices.find(item => item.key === String(data.get("choice")));
    if (!choice) { setMessage(`Select an existing R12 product colour for ${row.name} · ${row.colour}.`); return; }
    const rawPrice = String(data.get("price") ?? "").trim();
    let priceMinor: number | null = null;
    if (rawPrice !== "") {
      const parsedPrice = Math.round(Number(rawPrice) * 100);
      if (!Number.isFinite(Number(rawPrice)) || !Number.isSafeInteger(parsedPrice) || parsedPrice <= 0) {
        setMessage("Enter a valid website price in pounds, or leave it blank to use a single verified R12 catalogue price.");
        return;
      }
      priceMinor = parsedPrice;
    }
    const frontImage = String(data.get("frontImage") ?? "").trim();
    const backImage = String(data.get("backImage") ?? "").trim();
    const mappingVerified = data.get("mappingVerified") === "on";
    const published = data.get("published") === "on";
    const available = data.get("available") === "on";
    if (published && available && !mappingVerified) {
      setMessage("Confirm the selected R12 product, colour and photographs before publishing.");
      return;
    }
    const publication = {
      familyId: choice.familyId,
      variantColour: choice.variantColour,
      priceMinor,
      published,
      available,
      mappingVerified,
      frontImage,
      backImage: backImage || null,
    };
    setMessage("");
    startTransition(async () => {
      const result = await saveWebsiteShopPublication({
        organisationId, slug: row.slug, familyId: publication.familyId,
        variantColour: publication.variantColour, name: row.name, colour: row.colour,
        priceMinor, frontImage, backImage: publication.backImage,
        published: publication.published, available: publication.available, mappingVerified,
      });
      if (result.ok) { setSaved(current => ({ ...current, [row.slug]: publication })); setMessage(`${row.name} · ${row.colour} saved.`); }
      else setMessage(result.error);
    });
  }

  return <section className={styles.workspace} aria-label="Website shop products">
    <header className={styles.intro}><div><span className={styles.eyebrow}>PUBLIC CATALOGUE</span><h2>Website Shop</h2><p>Choose existing Madhouse Apparel products, set website prices and control publication. Member shop prices remain unchanged.</p></div><span className={styles.counter}>{rows.length} showroom colours</span></header>
    {choices.length === 0 ? <div className={styles.empty}><strong>No R12 apparel products are available to map yet.</strong><p>After the Madhouse Apparel products are present in this organisation’s catalogue, refresh this page to map them.</p></div> : <div className={styles.products}>
      {rows.map(row => {
        const publication = saved[row.slug];
        const proposal = proposals[row.slug as WebsiteShopSlug];
        const proposedKey = proposal ? `${proposal.familyId}:${proposal.variantColour}` : "";
        const selectedKey = publication ? `${publication.familyId}:${publication.variantColour}` : choices.some(choice => choice.key === proposedKey) ? proposedKey : "";
        const proposedChoice = choices.find(choice => choice.key === proposedKey);
        return <form key={row.slug} className={styles.product} onSubmit={event => { event.preventDefault(); save(row, event.currentTarget); }}>
          <div className={styles.productHead}><div><h3>{row.name}</h3><p>{row.colour}</p></div><code>{row.slug}</code></div>
          {proposal && <div className={styles.proposal}><strong>Proposed R12 match</strong><span>{proposal.familyName} · {proposal.variantColour}</span>{proposal.reviewNote && <p>{proposal.reviewNote}</p>}{proposedChoice?.defaultPriceMinor != null && <small>Current catalogue default: {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(proposedChoice.defaultPriceMinor / 100)}</small>}</div>}
          <label>R12 catalogue product and colour<select name="choice" defaultValue={selectedKey} required onChange={event => { if (publication && event.currentTarget.value !== `${publication.familyId}:${publication.variantColour}`) clearMappingConfirmation(event.currentTarget.form); }}><option value="" disabled>Select a verified product</option>{choices.map(choice => <option key={choice.key} value={choice.key}>{choiceLabel(choice)}</option>)}</select></label>
          <div className={styles.priceRow}><label>Website price (£)<input name="price" inputMode="decimal" type="number" min="0.01" step="0.01" defaultValue={publication?.priceMinor == null ? "" : (publication.priceMinor / 100).toFixed(2)} placeholder="Use R12 price" /></label><span>R12 prices remain unchanged</span></div>
          <label>Approved front image path<input name="frontImage" required pattern="/apparel/[A-Za-z0-9._/-]+" defaultValue={publication?.frontImage ?? row.frontImage} onChange={event => clearMappingConfirmation(event.currentTarget.form)} /></label>
          {row.kind === "tee" && <label>Approved back image path<input name="backImage" pattern="/apparel/[A-Za-z0-9._/-]+" defaultValue={publication?.backImage ?? row.backImage ?? ""} onChange={event => clearMappingConfirmation(event.currentTarget.form)} /></label>}
          <div className={styles.flags}><label><input type="checkbox" name="published" defaultChecked={publication?.published ?? false} /> Published on website</label><label><input type="checkbox" name="available" defaultChecked={publication?.available ?? false} /> Available to order</label></div>
          <label className={styles.mappingCheck}><input type="checkbox" name="mappingVerified" defaultChecked={publication?.mappingVerified ?? false} /><span>I checked that the selected R12 product, colour and photos match this showroom garment.</span></label>
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save product"}</button>
        </form>;
      })}
    </div>}
    <section className={styles.preview} aria-label="Published website catalogue preview">
      <div><span className={styles.eyebrow}>PUBLIC VIEW</span><h3>Published catalogue preview</h3></div>
      {previewItems.length ? <div className={styles.previewGrid}>{previewItems.map(({ row, choice, priceMinor }) => <article key={row.slug}><strong>{row.name} · {row.colour}</strong><span>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(priceMinor / 100)}</span><small>{choice.sizes.join(" · ")}</small></article>)}</div> : <p>No verified products are currently published and available.</p>}
    </section>
    <p className={styles.note}>Apparel is made to order; no stock counts are collected here. A published product appears only when R12 confirms a valid price and at least one active size.</p>
    <p className={styles.status} aria-live="polite">{message}</p>
  </section>;
}

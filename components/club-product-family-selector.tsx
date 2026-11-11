"use client";

import { useEffect, useRef, useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import { filterRenderableFamilyCards, groupProductFamilies, memberProductFamilyTitle, memberVariantChoices, money, availableVariantPriceLabel, type ClubProductFamily, type FamilyCard } from "@/lib/club-product-families";
import { memberProductFulfilmentLabel, type MemberAvailabilityState } from "@/lib/club-member-availability";
import { ClubProductGallery, ClubProductMedia, productImageUrl, productWithImage, sharedProductImage } from "./club-product-media";

type Props = { compact?: boolean; products: ClubCommerceProduct[]; families?: ClubProductFamily[]; cards?: FamilyCard[]; organisationId: string; availability?: Record<string, MemberAvailabilityState>; locationChoices?: Array<{ id: string; name: string }>; locationChoicesFor?: (product: ClubCommerceProduct) => Array<{ id: string; name: string }>; selectedLocationId?: string; onLocationChange?: (locationId: string) => void; onAdd: (product: ClubCommerceProduct, quantity?: number) => void; title?: string };
const stateFor = (product: ClubCommerceProduct, availability: Record<string, MemberAvailabilityState>): MemberAvailabilityState => availability[product.id] ?? (product.stockTracked ? "IN_GYM" : product.supplierAvailabilityStatus === "available" ? "SUPPLIER_ORDER" : "UNAVAILABLE");
const familyState = (card: FamilyCard, availability: Record<string, MemberAvailabilityState>) => card.variants.some(p => stateFor(p, availability) === "IN_GYM") ? "IN_GYM" : card.variants.some(p => stateFor(p, availability) === "OTHER_GYM") ? "OTHER_GYM" : card.variants.some(p => stateFor(p, availability) === "SUPPLIER_ORDER") ? "SUPPLIER_ORDER" : "UNAVAILABLE";

export function ClubProductFamilySelector({ compact = false, products, families = [], cards: suppliedCards, organisationId, availability = {}, locationChoices = [], locationChoicesFor, selectedLocationId, onLocationChange, onAdd }: Props) {
  const [picked, setPicked] = useState<FamilyCard>();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const cards = suppliedCards ?? groupProductFamilies(products, families, organisationId, availability);
  const choices = picked ? memberVariantChoices(picked.variants, selection, product => stateFor(product, availability) !== "UNAVAILABLE" && product.sellPriceMinor > 0) : undefined;
  const resolved = choices?.resolved;
  const controls = choices?.controls.filter(control => control.key !== "orderUnit" && control.key !== "packQuantity");
  const visibleCards = filterRenderableFamilyCards(cards, availability);
  const preview = resolved ?? (picked ? picked.variants.find(variant => Object.entries(selection).every(([key, value]) => String(variant.variantOptions?.[key] ?? "") === value)) ?? productWithImage(picked.variants) : undefined);
  const image = preview?.variantImageReference ? { ...preview, media: { ...(preview.media ?? {}), url: preview.variantImageReference } } : preview;
  const madhouseApparel = picked?.variants.some(variant => variant.brand?.trim().toLocaleLowerCase() === "madhouse apparel") ?? false;
  const price = picked ? availableVariantPriceLabel(picked.variants, availability) : "";
  const resolvedLocations = resolved ? locationChoicesFor?.(resolved) ?? locationChoices : [];
  const modalFulfilment = picked ? memberProductFulfilmentLabel(resolved ? stateFor(resolved, availability) : familyState(picked, availability), madhouseApparel) : "";

  useEffect(() => {
    if (!picked) return;
    const opener = openerRef.current;
    closeRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setPicked(undefined); };
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); });
    };
  }, [picked]);

  const open = (card: FamilyCard, element: HTMLElement) => {
    openerRef.current = element;
    setPicked(card);
    setSelection({});
    setQuantity(1);
  };

  return <>
    <div className={`club-family-grid checkout-products${compact ? " club-family-grid-compact" : ""}`}>
      {visibleCards.map(card => {
        const cardImage = card.variants.find(variant => productImageUrl(variant)) ?? card.variants[0];
        const title = memberProductFamilyTitle(card.label, card.variants[0]);
        const status = familyState(card, availability);
        const apparel = card.variants.some(variant => variant.brand?.trim().toLocaleLowerCase() === "madhouse apparel");
        return <article className="club-family-card" key={card.family?.id ?? card.label}>
          <button className="club-family-select" type="button" onClick={event => open(card, event.currentTarget)}>
            <div className="club-family-image">{sharedProductImage(card.variants) ? <ClubProductMedia product={cardImage} style={{ objectFit: "contain", objectPosition: "center", padding: 8 }} /> : null}</div>
            {card.family?.brand || card.variants[0].brand ? <small>{card.family?.brand ?? card.variants[0].brand}</small> : null}
            <strong>{title}</strong>
            <span>{availableVariantPriceLabel(card.variants, availability)}</span>
            {status !== "UNAVAILABLE" ? <small className="club-family-fulfilment">{memberProductFulfilmentLabel(status, apparel)}</small> : null}
          </button>
        </article>;
      })}
    </div>
    {picked ? <div className="club-family-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPicked(undefined); }}>
      <div ref={dialogRef} className={`club-family-sheet${madhouseApparel ? " madhouse-apparel-detail" : ""}`} role="dialog" aria-modal="true" aria-labelledby="club-family-title" tabIndex={-1}>
        <button ref={closeRef} type="button" className="club-family-close" aria-label="Close product details" onClick={() => setPicked(undefined)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        <div className="club-family-detail-layout">
          <div className="club-product-detail-image">{image ? <ClubProductGallery product={image} resetKey={selection.colour ?? selection.color} /> : <div className="club-product-placeholder" role="img" aria-label={`Image unavailable for ${picked.label}`}>Image unavailable</div>}</div>
          <div className="club-family-detail-content">
            <div className="club-family-product-heading">
              <h2 id="club-family-title">{memberProductFamilyTitle(picked.label, picked.variants[0])}</h2>
              {picked.family?.brand || picked.variants[0].brand ? <p>{picked.family?.brand ?? picked.variants[0].brand}</p> : null}
            </div>
            {resolved ? <p className="club-family-price"><strong>{money(resolved.sellPriceMinor)}</strong></p> : price ? <p className="club-family-price"><strong>{price}</strong></p> : <p className="club-family-price unavailable">Price unavailable</p>}
            {modalFulfilment !== "UNAVAILABLE" ? <p className={`club-family-fulfilment${madhouseApparel && modalFulfilment === "Made to order" ? " club-made-to-order" : ""}`}>{modalFulfilment}</p> : <p className="club-family-fulfilment unavailable">Unavailable to order</p>}
            {controls?.map(({ key, values }, index) => {
              const label = key === "size" ? "Size" : key === "colour" || key === "color" ? "Colour" : "Flavour";
              const update = (value: string) => setSelection({ ...Object.fromEntries((controls ?? []).slice(0, index).map(control => [control.key, selection[control.key]])), [key]: value });
              return <div className="club-family-option-group" key={key}>
                <span className="club-family-option-label">{label}</span>
                {key === "flavour" ? <select className="club-family-select-control" aria-label={label} value={selection[key] ?? ""} onChange={event => update(event.target.value)}><option value="">Choose a flavour</option>{values.map(({ value, disabled }) => <option value={value} key={value} disabled={disabled}>{value}</option>)}</select> : <div className="club-family-options" role="group" aria-label={label}>{values.map(({ value, disabled }) => <button className="club-family-option" type="button" key={value} disabled={disabled} aria-pressed={selection[key] === value} onClick={() => update(value)}>{value}</button>)}</div>}
              </div>;
            })}
            {resolved && resolvedLocations.length > 1 ? <label className="club-family-collection">Collection location<select value={selectedLocationId ?? ""} onChange={event => onLocationChange?.(event.target.value)}>{resolvedLocations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label> : null}
            {!compact ? <div className="club-family-quantity"><span className="club-family-option-label">Quantity</span><div role="group" aria-label="Quantity"><button type="button" aria-label="Decrease quantity" disabled={quantity === 1} onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button><strong aria-live="polite">{quantity}</strong><button type="button" aria-label="Increase quantity" disabled={quantity === 20} onClick={() => setQuantity(value => Math.min(20, value + 1))}>+</button></div></div> : null}
            <button type="button" className="primary full club-family-add" disabled={!resolved || stateFor(resolved, availability) === "UNAVAILABLE"} onClick={() => { if (resolved) { onAdd(resolved, quantity); setPicked(undefined); setQuantity(1); } }}>Add to basket</button>
          </div>
        </div>
      </div>
    </div> : null}
  </>;
}

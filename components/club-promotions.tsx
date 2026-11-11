"use client";

import { useState, useTransition } from "react";
import { dealMakerOffers } from "@/lib/club-deal-maker";
import {
  configureGsnPotOGoldPromotionAction,
  saveClubPromotionAction,
  setClubPromotionStatusAction,
} from "@/app/club/promotions/actions";

type PromotionRow = {
  id: string; name: string; description?: string; status: string; starts_at?: string; ends_at?: string;
  location_ids?: string[]; eligibility?: Record<string, unknown>;
};
function statusOf(promotion: { status: string; starts_at?: string; ends_at?: string }, now = Date.now()) {
  if (promotion.ends_at && new Date(promotion.ends_at).getTime() <= now) return "Ended";
  if (promotion.status !== "active") return promotion.status === "draft" ? "Scheduled" : "Paused / disabled";
  if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now) return "Scheduled";
  return "Live";
}

function localDate(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

export function ClubPromotions({
  organisationId, promotions = [],
}: {
  organisationId: string; promotions?: PromotionRow[];
}) {
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const configureGsn = () => startTransition(async () => {
    const result = await configureGsnPotOGoldPromotionAction({ organisationId });
    setMessage(result.ok ? `GSN 10 Meals for £32 configured for ${result.eligibleProducts} current GSN products.` : (result.error ?? "Promotion action failed."));
  });

  const toggleRetailPromotion = (promotion: PromotionRow) => startTransition(async () => {
    const result = await setClubPromotionStatusAction({ organisationId, promotionId: promotion.id, status: promotion.status === "active" ? "paused" : "active" });
    setMessage(result.ok ? "Promotion status updated." : (result.error ?? "Promotion action failed."));
  });



  return <section aria-label="Promotions and offers">
    <div className="card">
      <div className="section-heading"><div><span className="eyebrow">SHOP PROMOTION MANAGEMENT</span><h2>Current and upcoming shop offers</h2></div><button type="button" className="secondary" onClick={configureGsn} disabled={pending}>Configure GSN 10 for £32</button></div>
      {["Live", "Scheduled", "Paused / disabled", "Ended"].map(group => <section key={group}>
        <h3>{group}</h3>
        {promotions.filter(promotion => statusOf(promotion) === group).map(promotion => {
          const eligibility = promotion.eligibility ?? {};
          const bundle = Array.isArray(eligibility.bundle_groups) ? eligibility.bundle_groups[0] as Record<string, unknown> : undefined;
          return <article className="card" key={promotion.id}>
            <button type="button" className="text-button" onClick={() => setSelected(selected === promotion.id ? undefined : promotion.id)}><strong>{promotion.name}</strong></button>
            <p>{bundle ? `${bundle.required_quantity} items for £${(Number(eligibility.bundle_price_minor ?? 0) / 100).toFixed(2)} · ${Array.isArray(bundle.product_ids) ? bundle.product_ids.length : 0} products · Mix & match` : promotion.description ?? "Offer"}</p>
            <small>{promotion.ends_at ? `Ends ${localDate(promotion.ends_at)} · ` : "No end date · "}{promotion.location_ids?.length ? "Selected locations" : "All locations / global"}</small>
            {selected === promotion.id && group !== "Ended" ? <button type="button" className="secondary" disabled={pending} onClick={() => toggleRetailPromotion(promotion)}>{promotion.status === "active" ? "Pause promotion" : "Reactivate promotion"}</button> : null}
          </article>;
        })}
      </section>)}
    </div>

    <details className="card"><summary>Create a promotion with Deal Maker</summary><form onSubmit={event => {
      event.preventDefault();
      startTransition(async () => {
        const form = new FormData(event.currentTarget);
        const result = await saveClubPromotionAction({
          organisationId, name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(), endsAt: form.get("endsAt") ? new Date(String(form.get("endsAt"))).toISOString() : undefined,
          effectType: String(form.get("offer")) === "money_off" ? "fixed_discount" : "percentage_discount",
          percentageBasisPoints: String(form.get("offer")) === "money_off" ? undefined : Math.round(Number(form.get("value")) * 100),
          amountMinor: String(form.get("offer")) === "money_off" ? Math.round(Number(form.get("value")) * 100) : undefined,
          eligibility: (() => { const target = String(form.get("target")); const repeat = String(form.get("repeat")) === "yes"; const category = target !== "Everything" && target !== "Choose specific products" ? target : undefined; return String(form.get("offer")) === "bundle" ? { bundle_groups: [{ group_id: "deal-maker", required_quantity: Math.max(1, Number(form.get("quantity") || 10)), ...(category ? { categories: [category] } : {}) }], bundle_price_minor: Math.round(Number(form.get("value")) * 100), repeatable: repeat } : category ? { target_category: category } : {}; })(),
        });
        setMessage(result.ok ? "Offer saved." : (result.error ?? "Promotion action failed."));
      });
    }}>
      <p className="muted">Describe the offer in retail language; technical rule details stay hidden.</p>
      <label>What is this promotion for?<select name="target"><option>Everything</option><option>Food & Drinks</option><option>Supplements</option><option>Apparel / Merch</option><option disabled>Memberships (coming soon)</option><option disabled>Services (coming soon)</option><option>Choose specific products</option></select></label>
      <label>Promotion name<input name="name" required /></label><label>Description<input name="description" /></label>
      <label>Starts<input name="startsAt" type="datetime-local" required /></label><label>Ends<input name="endsAt" type="datetime-local" /></label>
      <label>What is the offer?<select name="offer">{dealMakerOffers.map(offer => <option key={offer.value} value={offer.value}>{offer.label}</option>)}</select></label>
      <label>Required quantity (for quantity deals)<input name="quantity" type="number" min="1" step="1" defaultValue="2" /></label><label>Value<input name="value" type="number" min="0" step="0.01" required /></label>
      <label>Repeat for complete qualifying groups?<select name="repeat"><option value="yes">Yes</option><option value="no">No</option></select></label><button className="primary" disabled={pending}>Create offer</button>
    </form></details>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

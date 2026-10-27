export type MemberBasketIntent = Record<string, number>;

/** Read the already-authoritative promotion evidence for basket presentation. */
export function winterBundleSavingMinor(applied: unknown[]) {
  return applied.reduce((total, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return total;
    const promotion = value as Record<string, unknown>;
    if (promotion.promotion_name !== "Madhouse Winter Hoodie + T-Shirt") return total;
    const saving = Number(promotion.applied_saving_minor ?? promotion.saving_minor ?? 0);
    return total + (Number.isSafeInteger(saving) && saving > 0 ? saving : 0);
  }, 0);
}

/** Basket persistence stores only the member's product/quantity intent. */
export function memberBasketStorageKey(organisationId: string, userId: string) {
  return `r12:member-basket:${organisationId}:${userId}`;
}

export function sanitiseMemberBasket(value: unknown, sellableProductIds?: ReadonlySet<string>): MemberBasketIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: MemberBasketIntent = {};
  for (const [productId, quantity] of Object.entries(value as Record<string, unknown>)) {
    if (sellableProductIds && !sellableProductIds.has(productId)) continue;
    if (!/^[-\w]{1,128}$/.test(productId) || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) continue;
    result[productId] = quantity;
  }
  return result;
}

export function readMemberBasket(storage: Pick<Storage, "getItem"> | undefined, key: string, sellableProductIds?: ReadonlySet<string>) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    return raw ? sanitiseMemberBasket(JSON.parse(raw), sellableProductIds) : {};
  } catch { return {}; }
}

export function writeMemberBasket(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, key: string, basket: MemberBasketIntent) {
  if (!storage) return;
  try {
    if (Object.keys(basket).length) storage.setItem(key, JSON.stringify(basket));
    else storage.removeItem(key);
  } catch { /* Storage can be unavailable in private browsing. */ }
}

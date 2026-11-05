import test from "node:test";
import assert from "node:assert/strict";
import { memberCardEligibilityFailure } from "../lib/member-shop-card-eligibility";
import { productImageUrl } from "../lib/club-product-image";
import type { ClubCommerceProduct } from "../lib/club-commerce";

test("member shop Products & Services card eligibility", async (t) => {
  await t.test("accepts online products explicitly routed to Madhouse Products & Services", () => {
    assert.equal(memberCardEligibilityFailure([{ active: true, stripe_merchant_entity: "madhouse_products_services", sales_channels: ["online"] }]), null);
  });
  await t.test("rejects wrong merchant, inactive and non-online items distinctly", () => {
    assert.equal(memberCardEligibilityFailure([{ active: true, stripe_merchant_entity: "madhouse_franchise", sales_channels: ["online"] }]), "merchant_route");
    assert.equal(memberCardEligibilityFailure([{ active: true, stripe_merchant_entity: null, sales_channels: ["online"] }]), "merchant_route");
    assert.equal(memberCardEligibilityFailure([{ active: true, stripe_merchant_entity: "madhouse_products_services", sales_channels: ["pos"] }]), "online_channel");
    assert.equal(memberCardEligibilityFailure([{ active: false, stripe_merchant_entity: "madhouse_products_services", sales_channels: ["online"] }]), "inactive_or_missing");
  });
  await t.test("requires a nonempty basket and does not use product category as a route", () => {
    assert.equal(memberCardEligibilityFailure([]), "empty");
    assert.equal(memberCardEligibilityFailure([{ active: true, stripe_merchant_entity: "madhouse_products_services", sales_channels: ["online"], category: "Services" }]), null);
  });
  await t.test("uses distinct branded local artwork for the four products without catalogue images", () => {
    assert.equal(productImageUrl({ name: "10 PT Session Block" } as ClubCommerceProduct), "/madhouse-shop/10-pt-session-block.svg");
    assert.equal(productImageUrl({ name: "Transformation Bronze" } as ClubCommerceProduct), "/madhouse-shop/transformation-bronze.svg");
    assert.equal(productImageUrl({ name: "Transformation Silver" } as ClubCommerceProduct), "/madhouse-shop/transformation-silver.svg");
    assert.equal(productImageUrl({ name: "Transformation Gold" } as ClubCommerceProduct), "/madhouse-shop/transformation-gold.svg");
    assert.equal(productImageUrl({ name: "Unmapped catalogue item" } as ClubCommerceProduct), undefined);
  });
});

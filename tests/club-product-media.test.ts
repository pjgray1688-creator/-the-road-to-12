import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { productImageUrl } from "../lib/club-product-image";

const media = readFileSync(new URL("../components/club-product-media.tsx", import.meta.url), "utf8");
const familySelector = readFileSync(new URL("../components/club-product-family-selector.tsx", import.meta.url), "utf8");
const memberShop = readFileSync(new URL("../components/club-member-shop.tsx", import.meta.url), "utf8");
const staffShop = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("shared product media uses a contained image and a dimension-preserving accessible failure fallback", () => {
  assert.match(media, /className=\{presentationClass\}[^>]*src=\{src\}[^>]*alt=\{product\.name\}/);
  assert.match(media, /onError=\{\(\) => setFailedSrc\(src\)\}/);
  assert.match(media, /failedSrc === src\) return <div className=\{`club-product-placeholder \$\{className \?\? ""\}`\.trim\(\)\} style=\{style\} role="img" aria-label=\{`Image unavailable for \$\{product\.name\}`\}>Image unavailable/);
  assert.match(css, /\.club-product-media-image\{[^}]*object-fit:contain[^}]*object-position:center/);
  assert.match(css, /\.club-family-image \.club-product-media-image,\.club-family-image \.club-product-placeholder\{width:100%;height:100%;padding:8px\}/);
  assert.match(css, /\.club-product-placeholder\{[^}]*display:grid[^}]*place-items:center/);
});

test("member and staff family cards share the same image component and stable square frame", () => {
  assert.match(familySelector, /ClubProductMedia product=\{cardImage\} style=\{\{ objectFit: "contain", objectPosition: "center", padding: 8 \}\}/);
  assert.match(memberShop, /ClubProductFamilySelector/);
  assert.match(staffShop, /ClubProductFamilySelector/);
  assert.match(staffShop, /ClubProductFamilySelector compact/);
  assert.match(css, /\.club-family-image\{width:100%;aspect-ratio:1 \/ 1;min-height:140px;display:grid;place-items:center;overflow:hidden/);
  assert.match(css, /\.staff-checkout \.club-family-grid-compact \.club-family-image\{aspect-ratio:1 \/ 1;min-height:88px;height:88px/);
  assert.match(css, /\.club-product-placeholder\.club-product-thumb\{display:grid;width:44px;height:44px/);
  assert.match(css, /\.staff-checkout \.club-product-placeholder\.club-product-thumb\{width:64px;height:64px\}/);
});

test("shared product detail image is bounded on desktop and compact on mobile without cropping", () => {
  assert.match(familySelector, /club-product-detail-image"><ClubProductMedia product=\{image\} className="club-product-large"/);
  assert.match(css, /\.club-product-detail-image\{[^}]*width:min\(100%,340px\)[^}]*height:clamp\(128px,25svh,210px\)/);
  assert.match(css, /\.club-product-detail-image \.club-product-large,\.club-product-detail-image \.club-product-placeholder\{[^}]*height:100%[^}]*object-fit:contain[^}]*object-position:center/);
  assert.match(css, /@media\(max-width:640px\)\{\.club-product-detail-image\{width:min\(100%,260px\);height:clamp\(118px,20svh,160px\)\}\}/);
});

test("family image selection and variant checkout path remain unchanged", () => {
  assert.match(familySelector, /card\.variants\.find\(variant => productImageUrl\(variant\)\) \?\? card\.variants\[0\]/);
  assert.match(familySelector, /const image = resolved\?\.variantImageReference/);
  assert.match(familySelector, /onAdd\(resolved\)/);
});

test("member and staff use one current supplier-image resolver while local imagery keeps precedence", () => {
  const product = { id: "applied-whey", organisationId: "org", name: "Applied Nutrition Whey", active: true, stockTracked: false, sellPriceMinor: 3000, currency: "GBP", supplierReference: "supplier_product:variant-1", variantImageReference: "https://cdn.test/applied-current.png", media: { url: "https://cdn.test/applied-stale.png" }, createdAt: "", updatedAt: "" };
  assert.equal(productImageUrl(product), "https://cdn.test/applied-current.png");
  assert.equal(productImageUrl({ ...product, variantImageReference: undefined }), "https://cdn.test/applied-stale.png");
  const local = { ...product, supplierReference: undefined, variantImageReference: "https://cdn.test/local-variant.png" };
  assert.equal(productImageUrl(local), "https://cdn.test/applied-stale.png");
  const memberPage = readFileSync("app/member-hub/shop/page.tsx", "utf8");
  const staffPage = readFileSync("app/club/shop/page.tsx", "utf8");
  assert.match(memberPage, /buildClubShopProductUniverse\(localProducts, supplierParents, organisationId\)/);
  assert.match(staffPage, /buildClubShopProductUniverse\(localProducts, durableRows, organisation\.id\)/);
  assert.doesNotMatch(memberPage, /media: \{ url: info\.variantImageUrl \}/);
  assert.match(memberShop, /ClubProductFamilySelector/);
  assert.match(staffShop, /ClubProductFamilySelector compact/);
});

test("mobile staff basket is a safe-area floating shortcut to the existing basket state", () => {
  assert.match(staffShop, /basketQuantity > 0 \|\| step === "success"/);
  assert.match(staffShop, /aria-controls="staff-checkout-basket"/);
  assert.match(staffShop, /className=\{`staff-checkout-basket\$\{mobileBasketOpen/);
  assert.match(staffShop, /aria-label="Close basket"/);
  assert.match(css, /\.staff-mobile-basket\{position:fixed[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.staff-checkout-basket\.is-mobile-open\{position:fixed/);
});

test("shared mobile Club layout keeps wide operational tables scrollable and modals inside the viewport", () => {
  assert.match(css, /\.club-page \.table-wrap\{max-width:100%;overflow-x:auto/);
  assert.match(css, /\.club-page \.modal \.sheet\{width:100%;max-height:calc\(100svh/);
  assert.match(css, /\.club-page\{width:100%;padding-inline:14px;overflow-x:clip\}/);
});

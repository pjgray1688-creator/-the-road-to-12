import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { clubNavigationLinks, activeClubNavigationPath } from "../lib/club-navigation";
import { reviewerClubProducts, reviewerClubStockBalances, reviewerClubLocations } from "../lib/play-reviewer-club-data";
import { filterMemberShopProducts } from "../lib/club-product-taxonomy";
import { isReceptionProductEligible } from "../lib/club-member-availability";

test("all operational roles retain the shared menu; only managers see management destinations", () => {
  for (const role of ["trainer", "gym_staff", "gym_admin", "owner"] as const) {
    const links = clubNavigationLinks(role, "example org", "example venue");
    for (const path of ["/club", "/club/reception", "/club/members", "/club/checks", "/club/induction", "/club/shop", "/club/classes", "/club/sunbeds", "/club/schedule", "/club/work"]) assert.ok(links.some(link => link.href.split("?")[0] === path));
    for (const link of links) { const url = new URL(link.href, "https://example.test"); assert.equal(url.searchParams.get("org"), "example org"); assert.equal(url.searchParams.get("location"), "example venue"); }
    assert.equal(links.some(link => link.label === "Finance"), ["gym_admin", "owner"].includes(role));
  }
  assert.equal(activeClubNavigationPath("/club/members/demo-member-active"), "/club/members");
});

test("Club reviewer products have synthetic sellable stock, media and channel declarations", () => {
  assert.ok(reviewerClubProducts.length >= 3);
  for (const product of reviewerClubProducts) {
    assert.ok(product.id.startsWith("demo-product-"));
    assert.ok(product.sellPriceMinor > 0);
    assert.ok(isReceptionProductEligible(product));
    assert.ok(existsSync(`public${product.media?.url}`));
    assert.ok(reviewerClubStockBalances.some(row => row.productId === product.id && row.availableToSell > 0 && reviewerClubLocations.some(location => location.id === row.locationId)));
  }
  assert.equal(filterMemberShopProducts(reviewerClubProducts, { category: "All", brand: "", query: "" }).length, reviewerClubProducts.length);
});

test("the native Club target uses its own persistent shell and actual route reporting", () => {
  assert.match(readFileSync("ios/R12Club/App/App.swift", "utf8"), /ClubNativeShell\(\)/);
  const source = readFileSync("ios/R12Club/App/ClubNativeShell.swift", "utf8");
  assert.match(source, /websiteDataStore = \.default\(\)/);
  assert.match(source, /\['pushState', 'replaceState'\]/);
  assert.match(source, /addEventListener\('popstate'/);
  assert.match(source, /message.frameInfo.isMainFrame/);
  assert.match(source, /state.updateRoute\(path\)/);
  assert.match(source, /safeAreaInset\(edge: \.bottom/);
  assert.match(source, /goBack\(\)/);
  const tabs = readFileSync("ios/R12Club/App/ClubNavigation.swift", "utf8");
  for (const title of ["Reception", "Daily Checks", "Members", "Shop", "More"]) assert.ok(tabs.includes(`title: "${title}"`));
  assert.doesNotMatch(tabs, /title: "(?:Glow Zone|Inductions|Overview)"/);
});

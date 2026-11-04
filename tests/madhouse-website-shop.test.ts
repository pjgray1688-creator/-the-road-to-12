import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MADHOUSE_ORGANISATION_ID, WEBSITE_SHOP_PROPOSALS, WEBSITE_SHOP_SIZES, resolveWebsitePrice, uniformActiveCataloguePrice } from "../lib/madhouse-website-shop-mappings";

const migration = readFileSync("supabase/migrations/2026-11-04-madhouse-website-shop.sql", "utf8");
const controlsMigration = readFileSync("supabase/migrations/2026-11-04-madhouse-website-shop-controls.sql", "utf8");
const managementPage = readFileSync("app/club/website-shop/page.tsx", "utf8");
const actions = readFileSync("app/club/website-shop/actions.ts", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const workflow = readFileSync(".github/workflows/validate-migrations-postgres.yml", "utf8");

test("website prices are isolated from member catalogue prices and scoped by organisation", () => {
  assert.match(migration, /club_website_shop_publications[\s\S]*organisation_id uuid not null/);
  assert.match(migration, /website_price_minor integer/);
  assert.match(migration, /unique \(organisation_id, public_slug\)/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'commerce\.pricing_manage'\)/);
  assert.match(migration, /f\.active and f\.archived_at is null/);
  assert.doesNotMatch(migration, /update public\.club_commerce_products[\s\S]{0,220}website_price_minor/);
});

test("anonymous catalogue access returns a narrow published view with no private commerce fields", () => {
  assert.match(migration, /revoke all privileges on public\.club_website_shop_publications from public, anon, authenticated/);
  assert.match(migration, /club_list_public_website_shop_catalogue\(p_organisation_id uuid\)/);
  assert.match(migration, /where w\.organisation_id = p_organisation_id and w\.published and w\.available/);
  assert.match(migration, /'price_minor', public_price/);
  assert.match(controlsMigration, /website_available_sizes/);
  assert.match(controlsMigration, /coalesce\(fs\.visible, true\)/);
  assert.doesNotMatch(controlsMigration, /active_variant_count = 8/);
  assert.match(migration, /w\.published and w\.available and w\.mapping_verified/);
  assert.match(migration, /'sizes', to_jsonb\(sizes\)/);
  assert.doesNotMatch(migration, /'cost_price_minor'|'customer_id'|'stripe_price_id'/);
  assert.match(migration, /grant execute on function public\.club_list_public_website_shop_catalogue\(uuid\) to anon, authenticated/);
});

test("Club manager reads omit cost fields and write through an authenticated capability-checked RPC", () => {
  assert.match(managementPage, /hasCapability\(context\.organisation\.id, user\.id, "commerce\.pricing_manage"\)/);
  assert.match(managementPage, /select\("brand,active,sell_price_minor,family_id,variant_options"\)/);
  assert.match(managementPage, /eq\("organisation_id", context\.organisation\.id\)\.ilike\("brand", "Madhouse Apparel"\)/);
  assert.doesNotMatch(managementPage, /cost_price_minor/);
  assert.match(actions, /client\.rpc\("club_update_website_shop_product"/);
  assert.match(actions, /hasCapability\(organisationId, user\.id, "commerce\.pricing_manage"\)/);
  assert.match(actions, /client\.rpc\("club_set_website_shop_family_visibility"/);
  assert.match(controlsMigration, /count\(distinct p\.variant_options ->> 'size'\) = cardinality\(p_available_sizes\)/);
  assert.doesNotMatch(controlsMigration, /update public\.club_commerce_products/);
});

test("Club management template covers every showroom colour without guessed product UUIDs", () => {
  assert.equal((managementPage.match(/slug: "(?:acid|hoodie|sweatshirt)-/g) ?? []).length, 21);
  assert.doesNotMatch(managementPage, /productId:\s*["']/);
});

test("all 21 showroom entries have unique proposed family and colour mappings", () => {
  const entries = Object.entries(WEBSITE_SHOP_PROPOSALS);
  assert.equal(entries.length, 21);
  assert.equal(new Set(entries.map(([slug]) => slug)).size, 21);
  assert.equal(new Set(entries.map(([, mapping]) => `${mapping.familyId}:${mapping.variantColour}`)).size, 21);
  assert.equal(MADHOUSE_ORGANISATION_ID, "fa44592a-1593-4ad3-a621-63a4a4bcbceb");
  assert.deepEqual(Object.fromEntries(["Heavy Oversized T-Shirt", "Pullover Hoodie", "Crewneck Sweatshirt"].map(family => [family, entries.filter(([, mapping]) => mapping.familyName === family).length])), {
    "Heavy Oversized T-Shirt": 6,
    "Pullover Hoodie": 9,
    "Crewneck Sweatshirt": 6,
  });
  for (const [slug, mapping] of entries) {
    assert.ok(controlsMigration.includes(`('${slug}','${mapping.familyId}','${mapping.variantColour}'`), `SQL mapping must match ${slug}`);
  }
  assert.equal(entries.filter(([, mapping]) => mapping.reviewNote).length, 0);
  const expectedColours: Record<string, string> = {
    "acid-black": "Black/Grey", "acid-blue": "Blue", "acid-brown": "Brown", "acid-forest-green": "Green", "acid-pink": "Pink", "acid-purple": "Purple",
    "hoodie-beige": "Cream", "hoodie-forest-green": "Green", "hoodie-charcoal": "Charcoal", "hoodie-white": "White", "hoodie-light-blue": "Light Blue", "hoodie-pink": "Pink", "hoodie-red": "Red", "hoodie-navy": "Navy", "hoodie-black": "Black",
    "sweatshirt-white": "White", "sweatshirt-black": "Black", "sweatshirt-brown": "Brown", "sweatshirt-grey": "Grey", "sweatshirt-tan": "Tan", "sweatshirt-cream": "Cream",
  };
  for (const [slug, colour] of Object.entries(expectedColours)) assert.equal(WEBSITE_SHOP_PROPOSALS[slug as keyof typeof WEBSITE_SHOP_PROPOSALS].variantColour, colour, slug);
  assert.ok(entries.filter(([slug]) => slug.startsWith("acid-")).every(([, mapping]) => mapping.familyId === "fccc70d5-2db2-45ab-be4f-3cd728c28aa8"));
  assert.ok(entries.filter(([slug]) => slug.startsWith("hoodie-")).every(([, mapping]) => mapping.familyId === "912a3ec3-c8cc-48c0-9d20-9223584d0714"));
  assert.ok(entries.filter(([slug]) => slug.startsWith("sweatshirt-")).every(([, mapping]) => mapping.familyId === "7f1116bb-2d32-408b-ac66-ac7cde04170b"));
});

test("catalogue price fallback supports ordered enabled-size subsets with one valid price", () => {
  assert.deepEqual(WEBSITE_SHOP_SIZES, ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]);
  const variants = WEBSITE_SHOP_SIZES.map(size => ({ size, active: true, sellPriceMinor: 2500 }));
  assert.equal(uniformActiveCataloguePrice(variants), 2500);
  assert.equal(resolveWebsitePrice(3100, variants), 3100);
  assert.equal(resolveWebsitePrice(null, variants), 2500);
  assert.equal(uniformActiveCataloguePrice(variants.slice(1)), 2500);
  assert.equal(uniformActiveCataloguePrice([]), null);
  assert.equal(uniformActiveCataloguePrice(variants.map((variant, i) => i === 4 ? { ...variant, sellPriceMinor: null } : variant)), null);
  assert.equal(uniformActiveCataloguePrice(variants.map((variant, i) => i === 4 ? { ...variant, sellPriceMinor: 2600 } : variant)), null);
});

test("approved mappings are seeded without changing member prices and Club hides internal mapping controls", () => {
  assert.match(migration, /published boolean not null default false/);
  assert.match(migration, /available boolean not null default false/);
  assert.match(migration, /mapping_verified boolean not null default false/);
  assert.match(controlsMigration, /mapping_verified = true/);
  assert.match(controlsMigration, /website_available_sizes text\[\] not null/);
  assert.match(controlsMigration, /website_shop\.settings_saved/);
  const seededSlugs = [...controlsMigration.matchAll(/^\s*\('((?:acid|hoodie|sweatshirt)-[a-z-]+)'/gm)].map(match => match[1]);
  assert.equal(seededSlugs.length, 21);
  assert.equal(new Set(seededSlugs).size, 21);
  assert.match(controlsMigration, /club_website_shop_family_settings/);
  assert.match(controlsMigration, /published = case when current_publication\.mapping_verified/);
  assert.match(managementPage, /WEBSITE_SHOP_MAPPINGS/);
  assert.doesNotMatch(managementPage, /mapping_verified|R12 catalogue product and colour dropdown|front image path/);
  assert.doesNotMatch(controlsMigration, /update public\.club_commerce_products/);
});

test("the forward migration is included in the deployment manifest and isolated SQL validation", () => {
  assert.match(manifest, /2026-11-04-madhouse-website-shop\.sql/);
  assert.match(manifest, /2026-11-04-madhouse-website-shop-controls\.sql/);
  const reconciliation = workflow.indexOf("2026-11-22-madhouse-final-state-reconciliation.sql");
  const websiteShop = workflow.indexOf("2026-11-04-madhouse-website-shop.sql", reconciliation);
  const controls = workflow.indexOf("2026-11-04-madhouse-website-shop-controls.sql", websiteShop);
  assert.ok(reconciliation >= 0 && websiteShop > reconciliation && controls > websiteShop);
  assert.match(workflow, /club_list_public_website_shop_catalogue/);
  assert.match(workflow, /club_update_website_shop_product\(uuid,text,integer,boolean,text\[\]\)/);
  assert.match(workflow, /has_table_privilege\('anon'.*'insert'\)/);
});

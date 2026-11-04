import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubWebsiteShop, type WebsiteShopChoice, type WebsiteShopRow } from "@/components/club-website-shop";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { MADHOUSE_ORGANISATION_ID, WEBSITE_SHOP_PROPOSALS, WEBSITE_SHOP_SIZES, uniformActiveCataloguePrice, type WebsiteShopSlug } from "@/lib/madhouse-website-shop-mappings";

const showroomRows: Omit<WebsiteShopRow, "publication">[] = [
  { slug: "acid-black", name: "Acid-Wash T-Shirt", colour: "Black", kind: "tee", frontImage: "/apparel/53db9107-7b29-4a92-811b-573779bb8bf6.JPG", backImage: "/apparel/cc03291e-9418-4d66-bb89-c9e86e658626.JPG" },
  { slug: "acid-blue", name: "Acid-Wash T-Shirt", colour: "Blue", kind: "tee", frontImage: "/apparel/f5dde856-20b6-4f96-b93c-bf8c5216b334.JPG", backImage: "/apparel/bcd3baf3-96c3-4c11-b440-deb82947da34.JPG" },
  { slug: "acid-brown", name: "Acid-Wash T-Shirt", colour: "Brown", kind: "tee", frontImage: "/apparel/madhouse-acid-wash-brown-tee-rail.png", backImage: "/apparel/437b35a6-9893-4f6f-9b2f-7a2833924fdb.JPG" },
  { slug: "acid-forest-green", name: "Acid-Wash T-Shirt", colour: "Forest Green", kind: "tee", frontImage: "/apparel/978db15f-307a-460c-b767-f75d9ea84720.JPG", backImage: "/apparel/f50fbb03-b1b6-41fc-94de-89c0a515b6d7.JPG" },
  { slug: "acid-pink", name: "Acid-Wash T-Shirt", colour: "Pink", kind: "tee", frontImage: "/apparel/e9c577b4-0d49-411b-88c0-c791c97afc00.JPG", backImage: "/apparel/ac9e01db-4d00-46ff-b84e-5f6c00fc668f.JPG" },
  { slug: "acid-purple", name: "Acid-Wash T-Shirt", colour: "Purple", kind: "tee", frontImage: "/apparel/521ab31d-5daf-441b-8c80-c9aaa2f40bfa.JPG", backImage: "/apparel/d0acaa80-8d7b-4236-b54a-691dc18b189b.JPG" },
  { slug: "hoodie-beige", name: "Hoodie", colour: "Beige", kind: "hoodie", frontImage: "/apparel/e2647e3c-9edb-4352-9266-0e12bc5f5d81.JPG", backImage: null },
  { slug: "hoodie-forest-green", name: "Hoodie", colour: "Forest Green", kind: "hoodie", frontImage: "/apparel/dad30b60-1180-4d1b-b6c8-c207077b2b0d.JPG", backImage: null },
  { slug: "hoodie-charcoal", name: "Hoodie", colour: "Charcoal", kind: "hoodie", frontImage: "/apparel/e1ac282b-a15e-4654-b426-0955aee415a7.JPG", backImage: null },
  { slug: "hoodie-white", name: "Hoodie", colour: "White", kind: "hoodie", frontImage: "/apparel/053d94b7-baa7-4dac-a0b4-6da6467d550f.JPG", backImage: null },
  { slug: "hoodie-light-blue", name: "Hoodie", colour: "Light Blue", kind: "hoodie", frontImage: "/apparel/484705cc-1b82-4514-a809-8ee6791f5f1a.JPG", backImage: null },
  { slug: "hoodie-pink", name: "Hoodie", colour: "Pink", kind: "hoodie", frontImage: "/apparel/95450a65-5c95-42c0-9bbc-28067a31203f.JPG", backImage: null },
  { slug: "hoodie-red", name: "Hoodie", colour: "Red", kind: "hoodie", frontImage: "/apparel/57243287-73e1-433d-a54c-fd4a66637209.JPG", backImage: null },
  { slug: "hoodie-navy", name: "Hoodie", colour: "Navy", kind: "hoodie", frontImage: "/apparel/31223c77-a079-4d76-b2e7-213381ae7cc3.JPG", backImage: null },
  { slug: "hoodie-black", name: "Hoodie", colour: "Black", kind: "hoodie", frontImage: "/apparel/12d33968-7fe0-41f6-87ef-5297c075f639.JPG", backImage: null },
  { slug: "sweatshirt-white", name: "Sweatshirt", colour: "White", kind: "sweatshirt", frontImage: "/apparel/8a2a8cc7-57b1-4ade-b026-a73281c23153.JPG", backImage: null },
  { slug: "sweatshirt-black", name: "Sweatshirt", colour: "Black", kind: "sweatshirt", frontImage: "/apparel/cf8e037c-b580-4cb9-9e4b-cce5bffcc3b0.JPG", backImage: null },
  { slug: "sweatshirt-brown", name: "Sweatshirt", colour: "Chocolate Brown", kind: "sweatshirt", frontImage: "/apparel/c5e96b59-286d-4553-a2cc-f3e431bd01dd.JPG", backImage: null },
  { slug: "sweatshirt-grey", name: "Sweatshirt", colour: "Light Grey", kind: "sweatshirt", frontImage: "/apparel/4626a8ca-5c9f-4ba4-b7d2-1447782e05f5.JPG", backImage: null },
  { slug: "sweatshirt-tan", name: "Sweatshirt", colour: "Tan", kind: "sweatshirt", frontImage: "/apparel/58b44fca-293c-42c8-88d8-5adefaada8a2.JPG", backImage: null },
  { slug: "sweatshirt-cream", name: "Sweatshirt", colour: "Cream", kind: "sweatshirt", frontImage: "/apparel/a2b08c26-1a49-4050-90a6-24deeb26a156.JPG", backImage: null },
];

type ProductRow = { id: string; brand: string | null; active: boolean; sell_price_minor: number | null; family_id: string | null; variant_options: Record<string, unknown> | null };
type FamilyRow = { id: string; name: string; brand: string | null; active: boolean; archived_at: string | null };

export default async function ClubWebsiteShopPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "commerce.pricing_manage"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Website Shop" /><EmptyState title="Management access required">Website product publication and public prices are limited to authorised Club managers.</EmptyState><AppNav /></AppShell>;
  }
  if (context.organisation.id !== MADHOUSE_ORGANISATION_ID) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Website Shop" /><EmptyState title="Madhouse organisation required">Switch to the confirmed Madhouse Apparel organisation to manage its public catalogue.</EmptyState><AppNav /></AppShell>;
  }

  const [productResult, familyResult, publicationResult] = await Promise.all([
    client.from("club_commerce_products").select("id,brand,active,sell_price_minor,family_id,variant_options").eq("organisation_id", context.organisation.id).ilike("brand", "Madhouse Apparel"),
    client.from("club_product_families").select("id,name,brand,active,archived_at").eq("organisation_id", context.organisation.id),
    client.from("club_website_shop_publications").select("public_slug,family_id,variant_colour,website_price_minor,published,available,mapping_verified,front_image_url,back_image_url").eq("organisation_id", context.organisation.id),
  ]);
  if (productResult.error || familyResult.error || publicationResult.error) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · PUBLIC CATALOGUE" title="Website Shop" description="A database setup step is required before website publications can be managed." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><EmptyState title="Website Shop setup is pending">Apply the reviewed Website Shop database migration before managing publication settings. No existing member-shop pricing has been changed.</EmptyState><AppNav /></AppShell>;
  }
  const products = (productResult.data ?? []) as ProductRow[];
  const families = new Map(((familyResult.data ?? []) as FamilyRow[]).map(family => [family.id, family]));
  const grouped = new Map<string, { choice: WebsiteShopChoice; variants: { size: unknown; active: boolean; sellPriceMinor: number | null }[] }>();
  for (const product of products) {
    if (product.brand?.toLocaleLowerCase() !== "madhouse apparel" || !product.family_id) continue;
    const family = families.get(product.family_id);
    const colour = typeof product.variant_options?.colour === "string" ? product.variant_options.colour : "";
    if (!family || family.brand?.toLocaleLowerCase() !== "madhouse apparel" || !colour) continue;
    const key = `${family.id}:${colour}`;
    const group = grouped.get(key) ?? { choice: { key, familyId: family.id, familyName: family.name, variantColour: colour, sizes: [], defaultPriceMinor: null, eligible: family.active && !family.archived_at }, variants: [] };
    const size = product.variant_options?.size;
    if (product.active && typeof size === "string" && WEBSITE_SHOP_SIZES.includes(size as typeof WEBSITE_SHOP_SIZES[number]) && !group.choice.sizes.includes(size)) group.choice.sizes.push(size);
    group.variants.push({ size, active: product.active, sellPriceMinor: product.sell_price_minor });
    grouped.set(key, group);
  }
  const choices = [...grouped.values()].map(({ choice, variants }) => ({
    ...choice,
    sizes: WEBSITE_SHOP_SIZES.filter(size => choice.sizes.includes(size)),
    defaultPriceMinor: uniformActiveCataloguePrice(variants),
  })).sort((a, b) => `${a.familyName} ${a.variantColour}`.localeCompare(`${b.familyName} ${b.variantColour}`));
  const publications = new Map((publicationResult.data ?? []).map((value: Record<string, unknown>) => [String(value.public_slug), value]));
  const rows: WebsiteShopRow[] = showroomRows.map(row => {
    const publication = publications.get(row.slug);
    return publication ? { ...row, publication: {
      familyId: String(publication.family_id), variantColour: String(publication.variant_colour),
      priceMinor: publication.website_price_minor == null ? null : Number(publication.website_price_minor),
      published: publication.published === true, available: publication.available === true,
      mappingVerified: publication.mapping_verified === true,
      frontImage: String(publication.front_image_url), backImage: typeof publication.back_image_url === "string" ? publication.back_image_url : null,
    } } : row;
  });
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · PUBLIC CATALOGUE" title="Website Shop" description="Review the proposed R12 match, confirm product and image identity, then manage website price and publication independently of member pricing." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubWebsiteShop organisationId={context.organisation.id} rows={rows} choices={choices} proposals={WEBSITE_SHOP_PROPOSALS} /><a className="text-button" href={`/club/products${query}`}>Return to Products & Pricing</a><AppNav /></AppShell>;
}

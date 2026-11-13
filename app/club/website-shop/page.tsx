import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubWebsiteShop, type WebsiteShopRow } from "@/components/club-website-shop";
import { ClubWebsiteShopNav } from "@/components/club-website-shop-nav";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { MADHOUSE_ORGANISATION_ID, WEBSITE_SHOP_MAPPINGS, WEBSITE_SHOP_SIZES, uniformActiveCataloguePrice, type WebsiteShopSlug } from "@/lib/madhouse-website-shop-mappings";

const showroomRows: Pick<WebsiteShopRow, "slug" | "name" | "colour" | "kind" | "frontImage" | "backImage">[] = [
  { slug: "acid-black", name: "Acid-Wash T-Shirt", colour: "Black", kind: "tee", frontImage: "/madhouse-apparel/tshirt-black-grey-front.jpg", backImage: "/madhouse-apparel/tshirt-black-grey-rear.jpg" },
  { slug: "acid-blue", name: "Acid-Wash T-Shirt", colour: "Blue", kind: "tee", frontImage: "/madhouse-apparel/tshirt-blue-front.jpg", backImage: "/madhouse-apparel/tshirt-blue-rear.jpg" },
  { slug: "acid-brown", name: "Acid-Wash T-Shirt", colour: "Brown", kind: "tee", frontImage: "/madhouse-apparel/tshirt-brown-front.jpg", backImage: "/madhouse-apparel/tshirt-brown-rear.jpg" },
  { slug: "acid-forest-green", name: "Acid-Wash T-Shirt", colour: "Forest Green", kind: "tee", frontImage: "/madhouse-apparel/tshirt-green-front.jpg", backImage: "/madhouse-apparel/tshirt-green-rear.jpg" },
  { slug: "acid-pink", name: "Acid-Wash T-Shirt", colour: "Pink", kind: "tee", frontImage: "/madhouse-apparel/tshirt-pink-front.jpg", backImage: "/madhouse-apparel/tshirt-pink-rear.jpg" },
  { slug: "acid-purple", name: "Acid-Wash T-Shirt", colour: "Purple", kind: "tee", frontImage: "/madhouse-apparel/tshirt-purple-front.jpg", backImage: "/madhouse-apparel/tshirt-purple-rear.jpg" },
  { slug: "hoodie-beige", name: "Hoodie", colour: "Beige", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-cream.jpg", backImage: null },
  { slug: "hoodie-forest-green", name: "Hoodie", colour: "Forest Green", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-green.jpg", backImage: null },
  { slug: "hoodie-charcoal", name: "Hoodie", colour: "Charcoal", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-charcoal.jpg", backImage: null },
  { slug: "hoodie-white", name: "Hoodie", colour: "White", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-white.jpg", backImage: null },
  { slug: "hoodie-light-blue", name: "Hoodie", colour: "Light Blue", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-light-blue.jpg", backImage: null },
  { slug: "hoodie-pink", name: "Hoodie", colour: "Pink", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-pink.jpg", backImage: null },
  { slug: "hoodie-red", name: "Hoodie", colour: "Red", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-red.jpg", backImage: null },
  { slug: "hoodie-navy", name: "Hoodie", colour: "Navy", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-navy.jpg", backImage: null },
  { slug: "hoodie-black", name: "Hoodie", colour: "Black", kind: "hoodie", frontImage: "/madhouse-apparel/hoodie-black.jpg", backImage: null },
  { slug: "sweatshirt-white", name: "Sweatshirt", colour: "White", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-white.jpg", backImage: null },
  { slug: "sweatshirt-black", name: "Sweatshirt", colour: "Black", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-black.jpg", backImage: null },
  { slug: "sweatshirt-brown", name: "Sweatshirt", colour: "Chocolate Brown", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-brown.jpg", backImage: null },
  { slug: "sweatshirt-grey", name: "Sweatshirt", colour: "Light Grey", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-grey.jpg", backImage: null },
  { slug: "sweatshirt-tan", name: "Sweatshirt", colour: "Tan", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-tan.jpg", backImage: null },
  { slug: "sweatshirt-cream", name: "Sweatshirt", colour: "Cream", kind: "sweatshirt", frontImage: "/madhouse-apparel/sweatshirt-cream.jpg", backImage: null },
];

type ProductRow = { brand: string | null; active: boolean; sell_price_minor: number | null; family_id: string | null; variant_options: Record<string, unknown> | null };

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

  const [productResult, publicationResult, familySettingsResult] = await Promise.all([
    client.from("club_commerce_products").select("brand,active,sell_price_minor,family_id,variant_options").eq("organisation_id", context.organisation.id).ilike("brand", "Madhouse Apparel"),
    client.from("club_website_shop_publications").select("public_slug,family_id,variant_colour,website_price_minor,published,available,website_available_sizes,front_image_url,back_image_url").eq("organisation_id", context.organisation.id),
    client.from("club_website_shop_family_settings").select("family_id,visible").eq("organisation_id", context.organisation.id),
  ]);
  if (productResult.error || publicationResult.error || familySettingsResult.error) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Madhouse Apparel — Website Shop" /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><EmptyState title="Website Shop update required">The Website Shop size and family settings migration must be applied before these controls can be used.</EmptyState><AppNav /></AppShell>;
  }
  const products = (productResult.data ?? []) as ProductRow[];
  const publications = new Map((publicationResult.data ?? []).map((value: Record<string, unknown>) => [String(value.public_slug), value]));
  const familyVisibility = new Map((familySettingsResult.data ?? []).map((value: Record<string, unknown>) => [String(value.family_id), value.visible === true]));
  const familyMeta = [
    { id: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", kind: "tee" as const, title: "Acid-Wash T-Shirts", defaultPriceMinor: 2500 },
    { id: "912a3ec3-c8cc-48c0-9d20-9223584d0714", kind: "hoodie" as const, title: "Hoodies", defaultPriceMinor: 3500 },
    { id: "7f1116bb-2d32-408b-ac66-ac7cde04170b", kind: "sweatshirt" as const, title: "Sweatshirts", defaultPriceMinor: 3500 },
  ];
  const rows: WebsiteShopRow[] = showroomRows.map(row => {
    const mapping = WEBSITE_SHOP_MAPPINGS[row.slug as WebsiteShopSlug];
    const publication = publications.get(row.slug) as Record<string, unknown> | undefined;
    const catalogueSizes = WEBSITE_SHOP_SIZES.filter(size => products.some(product => product.active && product.family_id === mapping.familyId && product.variant_options?.colour === mapping.variantColour && product.variant_options?.size === size));
    const enabledSizes = Array.isArray(publication?.website_available_sizes)
      ? WEBSITE_SHOP_SIZES.filter(size => (publication.website_available_sizes as unknown[]).includes(size) && catalogueSizes.includes(size))
      : catalogueSizes;
    const allVariants = products.filter(product => product.family_id === mapping.familyId && product.variant_options?.colour === mapping.variantColour)
      .map(product => ({ size: product.variant_options?.size, active: product.active, sellPriceMinor: product.sell_price_minor }));
    const enabledVariants = allVariants.filter(product => enabledSizes.includes(product.size as typeof WEBSITE_SHOP_SIZES[number]));
    return {
      ...row,
      familyId: mapping.familyId,
      defaultPriceMinor: uniformActiveCataloguePrice(enabledVariants) ?? uniformActiveCataloguePrice(allVariants),
      catalogueSizes,
      enabledSizes,
      visible: publication?.published === true && publication?.available === true,
      priceOverrideMinor: publication?.website_price_minor == null ? null : Number(publication.website_price_minor),
    };
  });
  const families = familyMeta.map(family => ({ ...family, visible: familyVisibility.get(family.id) ?? true }));
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MADHOUSE APPAREL" title="Madhouse Apparel — Website Shop" description="Manage public colourways, prices and made-to-order sizes. These settings do not change member-shop pricing." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubWebsiteShopNav organisationId={context.organisation.id} section="products"/><ClubWebsiteShop organisationId={context.organisation.id} rows={rows} families={families} /><AppNav /></AppShell>;
}

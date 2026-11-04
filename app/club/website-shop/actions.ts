"use server";

import { revalidatePath } from "next/cache";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { MADHOUSE_ORGANISATION_ID } from "@/lib/madhouse-website-shop-mappings";

export type WebsiteShopPublicationInput = {
  organisationId: string;
  slug: string;
  familyId: string;
  variantColour: string;
  name: string;
  colour: string;
  priceMinor: number | null;
  frontImage: string;
  backImage: string | null;
  published: boolean;
  available: boolean;
  mappingVerified: boolean;
};

export async function saveWebsiteShopPublication(input: WebsiteShopPublicationInput) {
  if (input.organisationId !== MADHOUSE_ORGANISATION_ID
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    || !input.familyId || !input.variantColour || !input.name.trim() || !input.colour.trim()
    || (input.priceMinor !== null && (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0))
    || !/^\/apparel\/[A-Za-z0-9._/-]+$/.test(input.frontImage) || input.frontImage.includes("..")
    || (input.backImage !== null && (!/^\/apparel\/[A-Za-z0-9._/-]+$/.test(input.backImage) || input.backImage.includes("..")))) {
    return { ok: false as const, error: "Check the product details and image paths." };
  }

  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in with an authorised Club account." };
  const context = await resolveClubOrganisationContext(client, user.id, input.organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "commerce.pricing_manage"))) {
    return { ok: false as const, error: "Website Shop management access is required." };
  }
  const { error } = await client.rpc("club_save_website_shop_publication", {
    p_organisation_id: context.organisation.id,
    p_public_slug: input.slug,
    p_family_id: input.familyId,
    p_variant_colour: input.variantColour,
    p_display_name: input.name.trim(),
    p_public_colour: input.colour.trim(),
    p_website_price_minor: input.priceMinor,
    p_front_image_url: input.frontImage,
    p_back_image_url: input.backImage,
    p_published: input.published,
    p_available: input.available,
    p_mapping_verified: input.mappingVerified,
  });
  if (error) return { ok: false as const, error: "The website product could not be saved. Check the selected catalogue product and try again." };
  revalidatePath("/club/website-shop");
  return { ok: true as const };
}

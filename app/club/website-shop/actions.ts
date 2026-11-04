"use server";

import { revalidatePath } from "next/cache";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { MADHOUSE_ORGANISATION_ID, WEBSITE_SHOP_SIZES } from "@/lib/madhouse-website-shop-mappings";

async function authorisedClient(organisationId: string) {
  if (organisationId !== MADHOUSE_ORGANISATION_ID) return { error: "Website Shop management access is required." } as const;
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Sign in with an authorised Club account." } as const;
  const context = await resolveClubOrganisationContext(client, user.id, organisationId);
  if (!context || !(await context.repository.hasCapability(organisationId, user.id, "commerce.pricing_manage"))) {
    return { error: "Website Shop management access is required." } as const;
  }
  return { client, organisationId } as const;
}

export async function saveWebsiteShopSettings(input: {
  organisationId: string;
  slug: string;
  priceMinor: number | null;
  visible: boolean;
  sizes: string[];
}) {
  if (input.organisationId !== MADHOUSE_ORGANISATION_ID
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    || (input.priceMinor !== null && (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0))
    || !Array.isArray(input.sizes)
    || input.sizes.some(size => !(WEBSITE_SHOP_SIZES as readonly string[]).includes(size))
    || new Set(input.sizes).size !== input.sizes.length) {
    return { ok: false as const, error: "Check the price and selected sizes." };
  }
  const auth = await authorisedClient(input.organisationId);
  if ("error" in auth) return { ok: false as const, error: auth.error };
  const { error } = await auth.client.rpc("club_update_website_shop_product", {
    p_organisation_id: input.organisationId,
    p_public_slug: input.slug,
    p_website_price_minor: input.priceMinor,
    p_available: input.visible,
    p_available_sizes: input.sizes,
  });
  if (error) return { ok: false as const, error: "Could not save this colourway. Refresh and try again." };
  revalidatePath("/club/website-shop");
  return { ok: true as const };
}

export async function saveWebsiteShopFamilyVisibility(input: { organisationId: string; familyId: string; visible: boolean }) {
  if (input.organisationId !== MADHOUSE_ORGANISATION_ID
    || !["fccc70d5-2db2-45ab-be4f-3cd728c28aa8", "912a3ec3-c8cc-48c0-9d20-9223584d0714", "7f1116bb-2d32-408b-ac66-ac7cde04170b"].includes(input.familyId)
    || typeof input.visible !== "boolean") {
    return { ok: false as const, error: "Check the product family." };
  }
  const auth = await authorisedClient(input.organisationId);
  if ("error" in auth) return { ok: false as const, error: auth.error };
  const { error } = await auth.client.rpc("club_set_website_shop_family_visibility", {
    p_organisation_id: input.organisationId,
    p_family_id: input.familyId,
    p_visible: input.visible,
  });
  if (error) return { ok: false as const, error: "Could not update this family. Refresh and try again." };
  revalidatePath("/club/website-shop");
  return { ok: true as const };
}

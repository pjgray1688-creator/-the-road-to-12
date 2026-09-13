"use client";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import type { FamilyCard } from "@/lib/club-product-families";
import type { MemberAvailabilityState } from "@/lib/club-member-availability";
import { ClubProductFamilySelector } from "./club-product-family-selector";
type Props={add:(product:ClubCommerceProduct)=>void;cards:FamilyCard[];availability?:Record<string,MemberAvailabilityState>};
// Shared selector renders sharedProductImage(card.variants) for every family.
export function ClubMemberShop({add,cards,availability={}}:Props){const products=cards.flatMap(card=>card.variants);return <><p className="r12-shop-debug r12-card-path-debug">R12 CARD PATH LIVE: ClubMemberShop → ClubProductFamilySelector</p><p className="r12-shop-debug r12-image-path-debug">R12 IMAGE PATH LIVE: ClubProductFamilySelector → ClubProductMedia</p><ClubProductFamilySelector products={products} families={cards.flatMap(card=>card.family?[card.family]:[])} organisationId={products[0]?.organisationId??""} availability={availability} cards={cards} onAdd={add}/></>;}

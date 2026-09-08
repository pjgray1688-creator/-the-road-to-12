"use client";
import { useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";

export function productImageUrl(product: ClubCommerceProduct | undefined) {
  const value = product?.media?.url ?? product?.media?.variantImageReference ?? product?.media?.parentImageReference;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function sharedProductImage(products: ClubCommerceProduct[]) {
  const urls = products.map(productImageUrl);
  return urls.find(Boolean);
}

export function ClubProductMedia({ product, className }: { product: ClubCommerceProduct; className?: string }) {
  const src = productImageUrl(product);
  if (!src) return null;
  return <ProductImageWithFallback product={product} src={src} className={className} />;
}

function ProductImageWithFallback({ product, src, className }: { product: ClubCommerceProduct; src: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  if (failedSrc === src) return <div className="club-product-placeholder" role="img" aria-label={`Image unavailable for ${product.name}`}>Image unavailable</div>;
  // Product media URLs are managed catalogue assets and may be hosted outside Next's image domains.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt={product.name} loading="lazy" onError={() => setFailedSrc(src)} />;
}

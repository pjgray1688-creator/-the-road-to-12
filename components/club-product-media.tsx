"use client";
import { useRef, useState } from "react";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import { productImageUrl } from "@/lib/club-product-image";
export { productImageUrl } from "@/lib/club-product-image";

/** Pick the concrete image-bearing variant for a family tile or fallback. */
export function productWithImage(products: ClubCommerceProduct[]) {
  return products.find(product => Boolean(productImageUrl(product)));
}

export function sharedProductImage(products: ClubCommerceProduct[]) {
  const urls = products.map(productImageUrl);
  return urls.find(Boolean);
}

export function productGalleryUrls(product: ClubCommerceProduct) {
  const media = product.media && typeof product.media === "object" ? product.media as Record<string, unknown> : {};
  const gallery = Array.isArray(media.gallery) ? media.gallery.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  const primary = productImageUrl(product);
  return [...new Set([primary, ...gallery].filter((value): value is string => Boolean(value)))];
}

export function ClubProductGallery({ product, resetKey }: { product: ClubCommerceProduct; resetKey?: string }) {
  const urls = productGalleryUrls(product);
  if (!urls.length) return null;
  return <ProductGallerySlides key={`${product.id}:${resetKey ?? ""}`} product={product} urls={urls} />;
}

function ProductGallerySlides({ product, urls }: { product: ClubCommerceProduct; urls: string[] }) {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<number | undefined>(undefined);
  const selected = Math.min(index, urls.length - 1);
  const move = (step: number) => setIndex(current => (current + step + urls.length) % urls.length);
  return <div className="club-product-gallery" onTouchStart={event => { touchStart.current = event.touches[0]?.clientX; }} onTouchEnd={event => { const start = touchStart.current; const end = event.changedTouches[0]?.clientX; if (start !== undefined && end !== undefined && Math.abs(end - start) > 44) move(end < start ? 1 : -1); touchStart.current = undefined; }}>
    <ProductImageWithFallback product={product} src={urls[selected]} className="club-product-large" />
    {urls.length > 1 ? <><button type="button" className="club-product-gallery-arrow previous" aria-label="Previous product image" onClick={() => move(-1)}><span aria-hidden="true">‹</span></button><button type="button" className="club-product-gallery-arrow next" aria-label="Next product image" onClick={() => move(1)}><span aria-hidden="true">›</span></button><span className="club-product-gallery-count" aria-live="polite">{selected + 1} / {urls.length}</span></> : null}
  </div>;
}

export function ClubProductMedia({ product, className, style }: { product: ClubCommerceProduct; className?: string; style?: React.CSSProperties }) {
  const src = productImageUrl(product);
  if (!src) return null;
  return <ProductImageWithFallback product={product} src={src} className={className} style={style} />;
}

function ProductImageWithFallback({ product, src, className, style }: { product: ClubCommerceProduct; src: string; className?: string; style?: React.CSSProperties }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const presentationClass = ["club-product-media-image", className].filter(Boolean).join(" ");
  if (failedSrc === src) return <div className={`club-product-placeholder ${className ?? ""}`.trim()} style={style} role="img" aria-label={`Image unavailable for ${product.name}`}>Image unavailable</div>;
  // Product media URLs are managed catalogue assets and may be hosted outside Next's image domains.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={presentationClass} style={style} src={src} alt={product.name} loading="lazy" onError={() => setFailedSrc(src)} />;
}

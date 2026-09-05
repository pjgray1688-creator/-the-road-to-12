import type { ClubCommerceProduct } from "@/lib/club-commerce";

export function productImageUrl(product: ClubCommerceProduct | undefined) {
  const value = product?.media?.url;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function sharedProductImage(products: ClubCommerceProduct[]) {
  const urls = products.map(productImageUrl);
  return urls[0] && urls.every(url => url === urls[0]) ? urls[0] : undefined;
}

export function ClubProductMedia({ product, className }: { product: ClubCommerceProduct; className?: string }) {
  const src = productImageUrl(product);
  if (!src) return null;
  // Product media URLs are managed catalogue assets and may be hosted outside Next's image domains.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt="" loading="lazy" />;
}

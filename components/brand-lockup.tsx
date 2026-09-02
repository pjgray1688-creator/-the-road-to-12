import Image from "next/image";
import { brand } from "@/lib/brand";

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "brand-lockup compact" : "brand-lockup"}><Image src={brand.markSrc} alt={brand.name} width={compact ? 48 : 112} height={compact ? 48 : 112} priority={!compact} /><span className="sr-only">{brand.name}</span></div>;
}

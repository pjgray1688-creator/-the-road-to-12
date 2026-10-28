import Image from "next/image";
import { authApps, type AuthApp } from "@/lib/auth-app";

export function AuthBrand({ app, compact = false }: { app: AuthApp; compact?: boolean }) {
  const brand = authApps[app];
  const size = compact ? 64 : app === "club" ? 144 : 96;
  return <div className={`auth-product-brand auth-product-${app}`} aria-label={brand.name}>
    <Image src={brand.markSrc} alt="" width={size} height={size} priority={!compact} />
    {app === "club" ? null : <span>{brand.name}</span>}
  </div>;
}

import Link from "next/link";
import { brand } from "@/lib/brand";
export function SiteFooter() { return <footer className="site-footer"><span>{brand.name}</span><nav><Link href="/account">Account</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></footer>; }

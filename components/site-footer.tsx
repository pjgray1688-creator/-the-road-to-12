import Link from "next/link";
import { brand } from "@/lib/brand";
export function SiteFooter() { return <footer className="site-footer"><span>{brand.name}</span><nav><Link href="/account">Account</Link><Link href="/privacy">R12 Training Privacy</Link><Link href="/club/privacy">R12 Club Privacy</Link><Link href="/coach/privacy">R12 Coach Privacy</Link><Link href="/glow-zone/privacy">Glow Zone Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link></nav></footer>; }

import Link from "next/link";
import { AccountDeletionRequest } from "@/components/account-deletion-request";
import { AuthBrand } from "@/components/auth-brand";
import { authAccountHref, authApps } from "@/lib/auth-app";
import { authDestination } from "@/lib/auth-return";

export const metadata = { title: "Delete your R12 account" };

export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ app?: string; privacyApp?: string }> }) {
  const context = authDestination(await searchParams);
  const brand = authApps[context.app];
  return <main className={`legal-page account-page auth-product-page auth-product-page-${context.app}`}>
    <AuthBrand app={context.app} />
    <header><div><p className="eyebrow">{brand.eyebrow} · ACCOUNT</p><h1 id="account-deletion-title">Delete your account</h1></div></header>
    <AccountDeletionRequest app={context.app} />
    <p><Link href={brand.privacyPath}>Privacy Policy</Link> · <Link href={authAccountHref(context.app, "signIn", brand.defaultReturnTo)}>Back to account</Link></p>
  </main>;
}

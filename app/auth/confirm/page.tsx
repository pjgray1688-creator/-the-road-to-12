import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { authAccountHref, authApps } from "@/lib/auth-app";
import { authDestination } from "@/lib/auth-return";

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; app?: string; next?: string }> }) {
  const params = await searchParams;
  const context = authDestination({ app: params.app, next: params.next }, true);
  const valid = Boolean(params.token_hash && params.type === "email");
  return <main className={`legal-page account-page auth-page verification-page auth-product-page auth-product-page-${context.app}`}>
    <AuthBrand app={context.app} />
    <p className="eyebrow">{authApps[context.app].eyebrow}</p>
    <h1>{valid ? "Confirm your email" : "Verification link unavailable"}</h1>
    {valid ? <><p className="verification-copy">Confirm this email address to finish creating your shared R12 account and continue to {authApps[context.app].name}.</p><form action="/auth/verify" method="post"><input type="hidden" name="token_hash" value={params.token_hash} /><input type="hidden" name="type" value="email" /><input type="hidden" name="app" value={context.app} /><input type="hidden" name="next" value={context.next} /><button className="primary" type="submit">Confirm email</button></form></> : <p className="verification-copy">This verification link is incomplete. Request a fresh email or sign in if you already verified.</p>}
    <Link className="verification-back" href={authAccountHref(context.app, "signIn", context.next)}>Continue to sign in</Link>
  </main>;
}

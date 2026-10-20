import Link from "next/link";
import { AccountDeletionRequest } from "@/components/account-deletion-request";

export const metadata = { title: "Delete your R12 account" };

export default function DeleteAccountPage() {
  return <main className="legal-page account-page">
    <header><span className="brand-mark">R12</span><div><p className="eyebrow">ACCOUNT</p><h1 id="account-deletion-title">Delete your account</h1></div></header>
    <AccountDeletionRequest />
    <p><Link href="/privacy">Privacy Policy</Link> · <Link href="/account">Back to account</Link></p>
  </main>;
}

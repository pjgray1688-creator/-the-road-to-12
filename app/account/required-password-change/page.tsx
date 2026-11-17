import type { Metadata } from "next";
import { RequiredPasswordChangeForm } from "@/components/required-password-change-form";

export const metadata: Metadata = { title: "Choose a new password · R12", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function RequiredPasswordChangePage() {
  return <main className="legal-page account-page auth-product-page">
    <header><div><p className="eyebrow">R12 ACCOUNT SECURITY</p><h1>Choose a new password</h1></div></header>
    <p>Your manager asked you to replace the temporary password before using R12.</p>
    <RequiredPasswordChangeForm />
  </main>;
}

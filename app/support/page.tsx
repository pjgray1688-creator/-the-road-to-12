import Link from "next/link";
import { privacyContactEmail } from "@/lib/legal";

export const metadata = {
  title: "R12 Support",
  description: "Contact R12 Digital Ltd for account, app and privacy support.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return <main className="legal-page">
    <header><span className="brand-mark">R12</span><div><p className="eyebrow">R12 Digital Ltd</p><h1>Support</h1></div></header>
    <p>For help with the R12 app, your account or a privacy request, email <a href={`mailto:${privacyContactEmail}`}>{privacyContactEmail}</a>.</p>
    <p>Tell us which app you use, what happened and the email associated with your account. Never send your password, payment card details or unnecessary health information. If you include a screenshot, hide other people&apos;s information.</p>
    <h2>Gym services</h2>
    <p>For membership cancellations, gym charges, bookings or physical access, contact your participating gym. We can help you identify the right contact if you are unsure.</p>
    <h2>Account deletion</h2>
    <p><Link href="/account/delete">Request deletion of your R12 account</Link>. Sign in, confirm your current password and type DELETE to submit a request for review. Submitting a request does not immediately erase your account or cancel a membership or payment agreement.</p>
    <p>If you cannot sign in or the request form is unavailable, email us to request deletion. We may need to verify your identity. We will review privacy requests and respond within one calendar month, explaining any lawful extension within that first month.</p>
    <p><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Use</Link> · <Link href="/account/delete">Account deletion</Link></p>
  </main>;
}

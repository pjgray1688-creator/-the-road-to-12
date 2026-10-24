import Link from "next/link";
import { privacyContactEmail } from "@/lib/legal";

/** Customer notice for the R12 member app; other apps retain their own notices. */
export function R12PrivacyPolicy() {
  return <main className="legal-page">
    <header><span className="brand-mark">R12</span><div><p className="eyebrow">R12 Digital Ltd</p><h1>Privacy Policy</h1></div></header>
    <p>Last updated: 24 October 2026</p>
    <p>This notice explains how personal information is used in R12, our fitness, training and progress app, including optional connected gym services.</p>
    <h2>Who is responsible</h2>
    <p>R12 Digital Ltd operates R12 and is responsible for your R12 account, the personal training service and support we provide. Contact us at <a href={`mailto:${privacyContactEmail}`}>{privacyContactEmail}</a> about this notice or your information.</p>
    <p>A participating gym or coach is responsible for the membership, services and records it manages, including its decisions about bookings, attendance, access, coaching and payments. R12 provides the software used to support those services. Access to shared records depends on your connection with the organisation and the permissions assigned to its users. Connecting a gym does not transfer responsibility for that gym&apos;s services to R12. Ask your gym or coach for its privacy notice; contact us if you need help identifying the organisation responsible for a record.</p>
    <h2>Information we use</h2>
    <ul>
      <li>Account information: your name, email, account identifier, sign-in and session information.</li>
      <li>Training and fitness information: your profile, goals, preferences, programmes, schedules, exercises, sets, repetitions, weights, cardio, workout history, feedback and notes.</li>
      <li>Health and progress information you choose to enter or connect, including body measurements, weight, recovery, sleep, heart-rate variability, resting heart rate and strain.</li>
      <li>If you use participating gym services: contact details such as phone number and address, date of birth and emergency contact details where required for joining, membership status, bookings, attendance, purchases, balances and payment references.</li>
      <li>Support and privacy information: what you send us, your account-deletion request, verification and response records.</li>
      <li>Technical information needed to deliver and protect the service, such as network requests, IP addresses, browser or device information and error records handled by our hosting and authentication services.</li>
    </ul>
    <p>Private progress-photo uploads are not currently available in R12. Please do not send photographs or sensitive information to support unless needed to resolve your request.</p>
    <h2>How information is used</h2>
    <p>We use account and training information to provide the services you request, save and display your workouts and progress, and tailor training suggestions to your profile. We use support information to answer enquiries and privacy requests, and technical information to operate the service, investigate faults and protect accounts against misuse. Connected gyms and coaches use the records needed to deliver the services you choose.</p>
    <p>Account and requested service administration is necessary to provide our service to you. Service security and support also serve our legitimate interests in operating a reliable, secure service. Information may be retained or disclosed where required by law. Health information receives additional protection under data-protection law. Optional connections are controlled by you; you can disconnect them as described below. R12 is not a medical device and does not provide medical advice.</p>
    <h2>WHOOP and health connections</h2>
    <p>If WHOOP is available and you choose to connect it, you are taken to WHOOP to authorise access. The connection requests recovery, sleep, cycle and workout information and permission to maintain the connection. R12 stores connection tokens and imported recovery, sleep-performance, heart-rate variability, resting-heart-rate, strain and timestamp information to show recovery context for training.</p>
    <p>You can disconnect WHOOP in R12 and revoke access through WHOOP. Disconnecting stops further syncing but does not automatically erase information already saved in R12. You can request deletion of those records. The current R12 app does not connect to Apple HealthKit.</p>
    <h2>Sharing and service providers</h2>
    <p>R12 uses Supabase for account authentication and database services and Vercel to host the web service. These services handle information needed to run and secure R12. Email services handle account and service messages and enquiries you send us. WHOOP handles the connection you authorise under its own privacy terms.</p>
    <p>When you use a participating gym or coach, information is available to authorised people who need it to provide that service. Payment services, including Stripe and, for relevant gym payment options, GoCardless or PayPal, process transactions under their own terms. R12 and the relevant merchant retain order, amount, status and payment-reference information. Do not send payment credentials to R12 support.</p>
    <p>Information may also be disclosed where required by law or necessary to address fraud, security incidents or legal claims. Contact us for information about the providers and international handling relevant to your account.</p>
    <h2>Device storage and tracking</h2>
    <p>R12 uses cookies and local device storage for sign-in, settings and training state, including workouts that can sync to your account. Signing out does not necessarily remove all locally saved training information; take care when sharing a device. R12 does not include advertising or cross-app advertising tracking features.</p>
    <h2>How long information is kept</h2>
    <p>Account and training information is kept to provide your ongoing account, workout history and requested services. When information is no longer needed for those purposes, it can be deleted or anonymised following review. Support and privacy-request records are kept as needed to resolve enquiries and demonstrate how requests were handled.</p>
    <p>Some records may need to remain after account deletion: for example, payment and accounting evidence required by law, unresolved refunds or disputes, and proportionate safety, fraud-prevention or audit records. Retention depends on the record&apos;s purpose and applicable obligations. We will explain relevant exceptions when responding to your request; account deletion does not promise immediate removal of every record or backup.</p>
    <h2>Account deletion</h2>
    <p>Open <Link href="/account/delete">Delete your account</Link> from your account settings or this website. Sign in to the account you want to delete, re-enter your current password and type DELETE to submit your request. If you cannot sign in or the form is unavailable, email <a href={`mailto:${privacyContactEmail}`}>{privacyContactEmail}</a>.</p>
    <p>This submits a request for review, rather than automatically erasing your account. Your account remains active while the request is processed. An authorised operator reviews the request and applicable retention requirements, arranges deletion or anonymisation of eligible personal information, and records the outcome. You can check the request status on the deletion page while you have access; we may contact you to verify identity or explain the outcome.</p>
    <p>We will review your request and respond within one calendar month. If a lawful extension is needed, we will explain why within that first month. Deleting an R12 account does not itself cancel a gym membership, Direct Debit, Stripe subscription or another service agreement; arrange cancellation separately with the relevant provider.</p>
    <h2>Your choices and rights</h2>
    <p>You can ask for access to, correction or deletion of your information, and may have rights to restrict or object to processing or receive a portable copy. Where processing relies on consent, you may withdraw it without affecting earlier lawful processing. Rights depend on the circumstances and applicable law. Contact us using the email above; we may need to verify your identity. For gym or coaching records, we will help direct your request to the responsible organisation.</p>
    <p>You can complain to the <a href="https://ico.org.uk/make-a-complaint/">UK Information Commissioner&apos;s Office</a>.</p>
    <h2>Security and changes</h2>
    <p>R12 uses authenticated accounts and access permissions to limit access to personal information. No online service can guarantee absolute security. We will update this notice when our services or information practices change and show the revision date above.</p>
    <p><Link href="/support">Support</Link> · <Link href="/terms">Terms of Use</Link> · <Link href="/account/delete">Account deletion</Link></p>
  </main>;
}

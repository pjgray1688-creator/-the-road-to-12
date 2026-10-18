"use client";

type Person = { customerId: string; displayName: string; accountState: string; sharedMembershipReviewRequired: boolean; payerConfirmationRequired: boolean; payerRecordMissing: boolean };
const labels: Record<string, string> = { linked: "R12 account linked", staff_assisted_activation_required: "Staff-assisted account setup", shared_email_requires_individual_confirmation: "Shared email — verify individually", personal_email_requires_confirmation: "Personal email verification required", ready_for_activation: "Ready for activation" };
function quote(value: string) { return `"${value.replaceAll('"', '""')}"`; }

export function ClubMemberActivationReadiness({ people }: { people: Person[] }) {
  const needingLogin = people.filter(person => person.accountState !== "linked").length;
  const familyReview = people.filter(person => person.sharedMembershipReviewRequired).length;
  const missingPayer = people.filter(person => person.payerRecordMissing || person.payerConfirmationRequired).length;
  const download = () => {
    const lines = [["member", "account_readiness", "shared_membership_review", "payer_confirmation_required", "payer_record_missing"], ...people.map(person => [person.displayName, labels[person.accountState] ?? person.accountState, person.sharedMembershipReviewRequired ? "yes" : "no", person.payerConfirmationRequired ? "yes" : "no", person.payerRecordMissing ? "yes" : "no"]).map(row => row.map(quote).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "member-account-readiness.csv"; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="surface" aria-labelledby="member-readiness-title" style={{ marginBlock: 18 }}>
    <div className="section-heading-row"><div><span className="eyebrow">MEMBER READINESS</span><h2 id="member-readiness-title">Individual account and household checks</h2></div><button className="secondary" type="button" onClick={download} disabled={!people.length}>Download review CSV</button></div>
    <p className="muted">{needingLogin} people need their own R12 login or verified personal email · {familyReview} people are in a shared membership requiring payer/relationship review · {missingPayer} shared memberships need payer confirmation or a payer record.</p>
    <p className="muted">This report does not merge identities or infer payment failure. Shared membership household review is required because the current model records holders and billing contact, but not verified family relationships. No email addresses are included in the download.</p>
    {people.length ? <div className="club-detail-list">{people.filter(person => person.accountState !== "linked" || person.sharedMembershipReviewRequired).slice(0, 30).map(person => <div className="club-detail-row" key={person.customerId}><span>{person.displayName}<small>{labels[person.accountState] ?? person.accountState}{person.sharedMembershipReviewRequired ? " · Shared coverage review" : ""}{person.payerRecordMissing ? " · Payer record missing" : person.payerConfirmationRequired ? " · Confirm payer" : ""}</small></span></div>)}</div> : <p className="muted">No member profiles were returned.</p>}
  </section>;
}

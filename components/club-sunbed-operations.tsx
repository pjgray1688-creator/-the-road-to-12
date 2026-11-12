"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  adjustGlowMinutesAction,
  completeGlowSaleAction,
  getGlowAgeAction,
  getGlowBalanceAction,
  getGlowHistoryAction,
  getGlowLoyaltyAction,
  removeGlowMinutesAction,
  searchGlowCustomersAction,
  updateGlowCustomerPhoneAction,
  verifyGlowAgeAction,
} from "@/app/club/sunbeds/actions";
import { glowZonePackages } from "@/lib/glow-zone";
import styles from "@/components/club-glow-zone-workspace.module.css";

type Customer = { id: string; userId: string; name: string; email: string; phone: string; isActiveMember: boolean };
type HistoryRow = Record<string, unknown>;
type CustomerDetails = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
};
type Props = {
  organisationId: string;
  locations: Array<{ id: string; name: string }>;
  canAdjust?: boolean;
  canVerifyAge?: boolean;
  canRecordCash?: boolean;
  canTakePayment?: boolean;
};

const displayDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

export function ClubSunbedOperations({
  organisationId,
  locations,
  canAdjust = false,
  canVerifyAge = false,
  canRecordCash = false,
  canTakePayment = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [results, setResults] = useState<Customer[]>([]);
  const [minutes, setMinutes] = useState("");
  const [adjustMinutes, setAdjustMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [adjustmentConfirmed, setAdjustmentConfirmed] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [age, setAge] = useState<"verified" | "under_18" | "required" | "error">("required");
  const [customerDetails, setCustomerDetails] = useState<CustomerDetails>({});
  const [balance, setBalance] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [packageId, setPackageId] = useState("payg");
  const [tender, setTender] = useState<"cash" | "external_card">(canRecordCash ? "cash" : "external_card");
  const [saleConfirmed, setSaleConfirmed] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const verificationInFlight = useRef(false);
  const saleInFlight = useRef(false);
  const adjustmentInFlight = useRef(false);
  const saleAttempt = useRef<{ signature: string; key: string } | null>(null);
  const locationId = locations.find(location => location.name.toLowerCase().includes("carlton"))?.id;

  const refresh = (userId: string) => startTransition(async () => {
    const [balanceResult, ageResult, historyResult, loyaltyResult] = await Promise.all([
      getGlowBalanceAction({ organisationId, userId }),
      getGlowAgeAction({ organisationId, userId }),
      getGlowHistoryAction({ organisationId, userId }),
      getGlowLoyaltyAction({ organisationId, userId }),
    ]);
    if (balanceResult.ok) {
      setBalance(balanceResult.balance.minutes);
      setNext(balanceResult.balance.next_expiry);
    }
    if (ageResult.ok) {
      setAge(ageResult.age?.status === "verified" ? "verified" : ageResult.age?.status === "under_18" ? "under_18" : "required");
      setCustomerDetails({
        firstName: ageResult.age?.first_name,
        lastName: ageResult.age?.last_name,
        email: ageResult.age?.email,
        phone: ageResult.age?.phone,
        verifiedAt: ageResult.age?.verified_at,
        verifiedByName: ageResult.age?.verified_by_name,
      });
      setPhoneDraft(ageResult.age?.phone ?? "");
    } else setAge("error");
    if (historyResult.ok) setHistory(historyResult.history);
    if (loyaltyResult.ok) setLoyalty(loyaltyResult.qualifyingSessions);
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      startTransition(async () => {
        const found = await searchGlowCustomersAction({ organisationId, query });
        setResults(found.ok ? found.results : []);
        if (!found.ok) {
          setIsError(true);
          setMessage(found.error ?? "Customer search is unavailable.");
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, organisationId]);

  const packages = selected?.isActiveMember ? glowZonePackages.filter(item => item.membersOnly) : glowZonePackages.filter(item => !item.membersOnly);
  const selectedPackage = glowZonePackages.find(item => item.id === packageId);
  const saleMinutes = packageId === "payg" ? Number(minutes) : selectedPackage?.minutes ?? 0;
  const saleTotal = packageId === "payg" ? saleMinutes * 100 : selectedPackage?.priceMinor ?? 0;

  const choose = (customer: Customer) => {
    setSelected(customer);
    setAdultConfirmed(false);
    setResults([]);
    setQuery("");
    setPackageId(customer.isActiveMember ? "member-30" : "standard-30");
    setMessage("");
    setIsError(false);
    setBalance(null);
    setHistory([]);
    setLoyalty(0);
    setPhoneOpen(false);
    setSaleOpen(false);
    setSaleConfirmed(false);
    setAdjustMinutes("");
    setReason("");
    setAdjustmentConfirmed(false);
    saleAttempt.current = null;
    refresh(customer.userId);
  };

  const verify = () => {
    if (!selected || !locationId || !adultConfirmed || verificationInFlight.current || pending) return;
    verificationInFlight.current = true;
    setMessage("");
    setIsError(false);
    startTransition(async () => {
      try {
        const result = await verifyGlowAgeAction({ organisationId, userId: selected.userId, locationId, isAdult: true });
        if (!result.ok) {
          setIsError(true);
          setMessage(result.error ?? "Age verification could not be recorded.");
          return;
        }
        setAdultConfirmed(false);
        setMessage("18+ check recorded. No date of birth or ID details were stored.");
        refresh(selected.userId);
      } finally {
        verificationInFlight.current = false;
      }
    });
  };

  const savePhone = () => {
    if (!selected || !locationId || pending) return;
    setMessage("");
    setIsError(false);
    startTransition(async () => {
      const result = await updateGlowCustomerPhoneAction({
        organisationId,
        customerId: selected.id,
        locationId,
        phone: phoneDraft,
      });
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error);
        return;
      }
      setCustomerDetails(previous => ({ ...previous, phone: result.phone }));
      setSelected(previous => previous ? { ...previous, phone: result.phone } : previous);
      setPhoneOpen(false);
      setMessage("Telephone number updated and audit recorded.");
    });
  };

  const sell = () => {
    if (!selected || !locationId || !saleConfirmed || saleInFlight.current || pending || !saleMinutes) return;
    const allowedTender = tender === "cash" ? canRecordCash : canTakePayment;
    if (!allowedTender) return;
    saleInFlight.current = true;
    const signature = [selected.userId, locationId, packageId, saleMinutes, tender].join(":");
    if (!saleAttempt.current || saleAttempt.current.signature !== signature) {
      saleAttempt.current = { signature, key: `glow-sale-${crypto.randomUUID()}` };
    }
    setMessage("");
    setIsError(false);
    startTransition(async () => {
      try {
        const result = await completeGlowSaleAction({
          organisationId,
          userId: selected.userId,
          locationId,
          packageId,
          minutes: saleMinutes,
          tenderType: tender,
          idempotencyKey: saleAttempt.current!.key,
        });
        if (!result.ok) {
          setIsError(true);
          setMessage(result.error ?? "Minute sale could not be completed.");
          return;
        }
        saleAttempt.current = null;
        setSaleConfirmed(false);
        setMessage("Payment recorded. Minutes have been added to the customer.");
        refresh(selected.userId);
      } finally {
        saleInFlight.current = false;
      }
    });
  };

  const adjust = (remove: boolean) => {
    if (!selected || !locationId || !adjustmentConfirmed || adjustmentInFlight.current || pending) return;
    adjustmentInFlight.current = true;
    startTransition(async () => {
      try {
        const fn = remove ? removeGlowMinutesAction : adjustGlowMinutesAction;
        const result = await fn({
          organisationId,
          userId: selected.userId,
          locationId,
          minutes: Number(adjustMinutes),
          reason,
          idempotencyKey: `glow-adjust-${selected.userId}-${crypto.randomUUID()}`,
        });
        if (!result.ok) {
          setIsError(true);
          setMessage(result.error ?? "Adjustment could not be recorded.");
          return;
        }
        setAdjustmentConfirmed(false);
        setReason("");
        setMessage("Balance correction recorded with its audit reason.");
        refresh(selected.userId);
      } finally {
        adjustmentInFlight.current = false;
      }
    });
  };

  const purchases = history.filter(item => item.kind === "credit" && item.source === "purchased").slice(0, 5);
  const sessions = history.filter(item => item.kind === "usage").slice(0, 5);
  const otherHistory = history.filter(item => item.kind !== "usage" && !(item.kind === "credit" && item.source === "purchased")).slice(0, 5);

  return (
    <div className={styles.workspace}>
      <section className={styles.panel} aria-labelledby="glow-customer-search-title">
        <div className={styles.panelHeader}>
          <span className={styles.eyebrow}>Customer accounts</span>
          <h2 id="glow-customer-search-title">Find a customer</h2>
        </div>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search name, email or phone"
            aria-label="Search name, email or phone"
            autoComplete="off"
          />
          {results.length ? (
            <div className={styles.resultList} aria-label="Glow Zone customer results">
              {results.map(customer => (
                <button className={styles.result} type="button" key={customer.id} onClick={() => choose(customer)}>
                  <span><strong>{customer.name}</strong><small>{customer.email || customer.phone || "No contact details recorded"}</small></span>
                  <span className={`${styles.statusPill} ${customer.isActiveMember ? styles.statusMember : ""}`}>{customer.isActiveMember ? "Member" : "Customer"}</span>
                </button>
              ))}
            </div>
          ) : query.trim().length >= 2 && !pending ? <p className={styles.empty}>No matching Glow Zone customer found.</p> : null}
        </div>
      </section>

      {selected ? (
        <section className={styles.panel} aria-labelledby="glow-customer-title">
          <div className={styles.customerHead}>
            <div>
              <span className={styles.eyebrow}>Selected customer</span>
              <h2 id="glow-customer-title">{[customerDetails.firstName, customerDetails.lastName].filter(Boolean).join(" ") || selected.name}</h2>
              <div className={styles.customerContact}>
                <span>{customerDetails.email || selected.email || "Email not recorded"}</span>
                <span>{customerDetails.phone || selected.phone || "Telephone not recorded"}</span>
              </div>
            </div>
            <span className={`${styles.statusPill} ${selected.isActiveMember ? styles.statusMember : ""}`}>{selected.isActiveMember ? "Active member" : "Glow Zone customer"}</span>
          </div>

          <div className={styles.detailsGrid}>
            <div className={styles.detailCard}>
              <small>Age verification</small>
              <strong className={age === "verified" ? styles.verified : age === "under_18" || age === "error" ? styles.error : ""}>
                {age === "verified" ? "18+ verified" : age === "under_18" ? "Under 18 · ineligible" : age === "error" ? "Status unavailable" : "Required"}
              </strong>
              {age === "verified" ? <p>{customerDetails.verifiedByName ? `Checked by ${customerDetails.verifiedByName}` : "Checked by authorised Carlton staff"}{customerDetails.verifiedAt ? ` · ${displayDate(customerDetails.verifiedAt)}` : ""}</p> : null}
            </div>
            <div className={styles.detailCard}><small>Available minutes</small><strong>{balance === null ? "Loading…" : `${balance} min`}</strong>{next ? <p>Next expiry {new Date(next).toLocaleDateString("en-GB")}</p> : null}</div>
            <div className={styles.detailCard}><small>Loyalty progress</small><strong>{loyalty >= 9 ? "Reward earned" : `${loyalty} of 9 sessions`}</strong><progress aria-label="Glow Zone loyalty progress" max={9} value={Math.min(loyalty, 9)} /></div>
          </div>

          {age === "required" && canVerifyAge ? (
            <div className={styles.confirmGroup}>
              <h3 className={styles.sectionTitle}>Verify age in person</h3>
              <label className={styles.check}><input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} />I checked acceptable ID and confirm this customer is 18 or over.</label>
              <button className={styles.button} type="button" disabled={pending || !adultConfirmed} onClick={verify}>{pending ? "Saving check…" : "Confirm age verification"}</button>
              <small>Selecting the checkbox or leaving this section does not save anything.</small>
            </div>
          ) : null}
          {age === "required" && !canVerifyAge ? <p className={styles.empty}>Age verification requires the authorised Carlton induction permission.</p> : null}
          {age === "under_18" ? <p className={styles.error}>The under-18 safeguarding restriction cannot be overridden by staff.</p> : null}

          <div className={styles.subsection}>
            <div className={styles.customerHead}><h3 className={styles.sectionTitle}>Contact telephone</h3><button className={styles.secondary} type="button" onClick={() => { setPhoneDraft(customerDetails.phone ?? selected.phone); setPhoneOpen(value => !value); }}>{phoneOpen ? "Cancel edit" : "Edit telephone"}</button></div>
            {phoneOpen ? <div className={styles.inlineForm}><label className={styles.field}>Telephone number<input type="tel" value={phoneDraft} onChange={event => setPhoneDraft(event.target.value)} autoComplete="tel" maxLength={25} /></label><button className={styles.button} type="button" disabled={pending || phoneDraft.trim().length < 7} onClick={savePhone}>{pending ? "Saving…" : "Save telephone"}</button></div> : <p className={styles.empty}>Telephone changes are audited. Email and account identity cannot be edited here.</p>}
          </div>

          <div className={styles.subsection}>
            <h3 className={styles.sectionTitle}>Sell minutes</h3>
            <button className={styles.button} type="button" aria-expanded={saleOpen} onClick={() => setSaleOpen(value => !value)}>{saleOpen ? "Close minute sale" : "Sell minutes"}</button>
            {saleOpen ? <div className={styles.managementBody}>
              <label className={styles.field}>Package<select value={packageId} onChange={event => { setPackageId(event.target.value); setSaleConfirmed(false); saleAttempt.current = null; }}><option value="payg">Pay as you go · £1.00 per minute</option>{packages.map(item => <option key={item.id} value={item.id}>{item.name} · {item.minutes} minutes · £{(item.priceMinor / 100).toFixed(2)}</option>)}</select></label>
              {packageId === "payg" ? <label className={styles.field}>Minutes<input type="number" min="1" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); setSaleConfirmed(false); saleAttempt.current = null; }} /></label> : null}
              {(canRecordCash || canTakePayment) ? <label className={styles.field}>Payment method<select value={tender} onChange={event => { setTender(event.target.value as typeof tender); setSaleConfirmed(false); saleAttempt.current = null; }}>{canRecordCash ? <option value="cash">Cash</option> : null}{canTakePayment ? <option value="external_card">Card terminal</option> : null}</select></label> : <p className={styles.error}>Payment permission is required to complete a minute sale.</p>}
              <div className={styles.saleSummary}><span>{saleMinutes || 0} minutes</span><strong>£{(saleTotal / 100).toFixed(2)}</strong></div>
              {saleMinutes > 0 && (tender === "cash" ? canRecordCash : canTakePayment) ? <label className={styles.check}><input type="checkbox" checked={saleConfirmed} onChange={event => setSaleConfirmed(event.target.checked)} />{tender === "cash" ? "I have received the cash amount shown." : "I confirmed this amount was paid on the card terminal."}</label> : null}
              <button className={styles.button} type="button" disabled={pending || !saleMinutes || !saleConfirmed || (tender === "cash" ? !canRecordCash : !canTakePayment)} onClick={sell}>{pending ? "Recording payment…" : "Confirm payment and credit minutes"}</button>
            </div> : null}
          </div>

          <div className={styles.subsection}>
            <h3 className={styles.sectionTitle}>Recent minute purchases</h3>
            {purchases.length ? <div className={styles.history}>{purchases.map((item, index) => <div className={styles.historyRow} key={`purchase-${index}`}><strong>{Number(item.minutes) > 0 ? `${item.minutes} minutes purchased` : "Minute purchase"}</strong><small>{displayDate(item.created_at)} · {String(item.source ?? "Recorded purchase")}</small><span>+{Number(item.minutes)} min</span></div>)}</div> : <p className={styles.empty}>No minute purchases recorded.</p>}
          </div>
          <div className={styles.subsection}>
            <h3 className={styles.sectionTitle}>Recent sessions</h3>
            {sessions.length ? <div className={styles.history}>{sessions.map((item, index) => <div className={styles.historyRow} key={`session-${index}`}><strong>Glow Zone session</strong><small>{displayDate(item.created_at)}</small><span>{Number(item.minutes)} min</span></div>)}</div> : <p className={styles.empty}>No sessions recorded.</p>}
          </div>
          {otherHistory.length ? <div className={styles.subsection}><h3 className={styles.sectionTitle}>Other balance activity</h3><div className={styles.history}>{otherHistory.map((item, index) => <div className={styles.historyRow} key={`other-${index}`}><strong>Balance correction</strong><small>{displayDate(item.created_at)}{item.reason ? ` · ${String(item.reason)}` : ""}</small><span>{Number(item.minutes) > 0 ? "+" : ""}{Number(item.minutes)} min</span></div>)}</div></div> : null}

          {canAdjust ? <details className={`${styles.panel} ${styles.managementPanel}`}>
            <summary><strong>Adjust minute balance</strong><span className={styles.statusPill}>Management only</span></summary>
            <div className={styles.managementBody}>
              <p className={styles.empty}>Use only to correct a recorded balance. Minute sales belong in “Sell minutes”.</p>
              <label className={styles.field}>Minutes<input type="number" min="1" step="1" value={adjustMinutes} onChange={event => { setAdjustMinutes(event.target.value); setAdjustmentConfirmed(false); }} /></label>
              <label className={styles.field}>Reason<input value={reason} onChange={event => { setReason(event.target.value); setAdjustmentConfirmed(false); }} maxLength={300} placeholder="Required for the audit record" /></label>
              <label className={styles.check}><input type="checkbox" checked={adjustmentConfirmed} onChange={event => setAdjustmentConfirmed(event.target.checked)} />I confirm this is a correction, not a customer purchase.</label>
              <div className={styles.actionRow}><button className={styles.secondary} type="button" disabled={pending || !Number(adjustMinutes) || !reason.trim() || !adjustmentConfirmed} onClick={() => adjust(false)}>Add minutes</button><button className={styles.danger} type="button" disabled={pending || !Number(adjustMinutes) || !reason.trim() || !adjustmentConfirmed} onClick={() => adjust(true)}>Remove minutes</button></div>
            </div>
          </details> : null}
          {message ? <p role="status" className={styles.feedback} data-error={isError}>{message}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

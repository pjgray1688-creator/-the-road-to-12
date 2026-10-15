"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { checkInStationScanAction } from "@/app/club/access/actions";

type StationLocation = { id: string; name: string };
type ScanResult = { allowed?: boolean; attendanceRecorded?: boolean; repeatVisit?: boolean; reason?: string; member?: { displayName?: string } | null; decidedAt?: string; checkedAt?: string | null };
const reasonLabel: Record<string,string> = { credential_not_found:"QR not recognised",membership_not_started:"Membership has not started",membership_expired:"Membership has expired",location_not_included:"This membership does not include this venue",location_disabled:"Check-in is unavailable at this venue",access_throttled:"Please ask reception for help" };

export function ClubCheckinStation({ organisationId, locations }: { organisationId: string; locations: StationLocation[] }) {
  const first = locations[0];
  const [locationId,setLocationId] = useState(first?.id ?? "");
  const [stationLabel,setStationLabel] = useState(first ? `${first.name} Front Desk` : "Front Desk");
  const [token,setToken] = useState("");
  const [message,setMessage] = useState<ScanResult>();
  const [localError,setLocalError] = useState("");
  const [pending,startTransition] = useTransition();
  const inputRef=useRef<HTMLInputElement>(null); const resetTimer=useRef<number | undefined>(undefined);
  const focusScan=useCallback(()=>{window.setTimeout(()=>inputRef.current?.focus(),40);},[]);
  useEffect(()=>{focusScan();return()=>{if(resetTimer.current)window.clearTimeout(resetTimer.current);};},[focusScan]);
  const reset=useCallback(()=>{setToken("");setMessage(undefined);setLocalError("");focusScan();},[focusScan]);
  const submit=()=>{
    const value=token.trim().toUpperCase();
    if(!/^R12-[A-F0-9]{32}$/.test(value)){setLocalError("Scan a valid R12 member QR code.");setToken("");focusScan();return;}
    if(!locationId||!stationLabel.trim()){setLocalError("Choose a venue and station name first.");return;}
    startTransition(async()=>{
      const response=await checkInStationScanAction({organisationId,locationId,stationLabel,credential:value});
      setToken("");
      if(!response.ok){setLocalError(response.error??"The check-in could not be completed.");setMessage(undefined);}
      else {setMessage(response.decision as ScanResult);setLocalError("");}
      resetTimer.current=window.setTimeout(reset,5000);
      focusScan();
    });
  };
  const firstName=message?.member?.displayName?.trim().split(/\s+/)[0] || "Member";
  const timestamp=message?.checkedAt ?? message?.decidedAt;
  return <main className="club-checkin-kiosk">
    <header><span className="eyebrow">R12 CLUB · CHECK-IN</span><h1>Welcome to the gym</h1><p>Scan your R12 member QR code</p></header>
    <div className="club-checkin-config" data-station-settings>
      <label>Venue<select aria-label="Check-in venue" value={locationId} onChange={event=>{setLocationId(event.target.value);const venue=locations.find(item=>item.id===event.target.value);if(venue&&/ Front Desk$/.test(stationLabel))setStationLabel(`${venue.name} Front Desk`);}}>{locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Station name<input aria-label="Station name" maxLength={80} value={stationLabel} onChange={event=>setStationLabel(event.target.value)} /></label>
    </div>
    <section className={`club-checkin-status${message?.allowed?" is-allowed":""}${message&&!message.allowed?" is-denied":""}`} aria-live="assertive">
      {message?.allowed ? <><span className="club-checkin-mark">✓</span><strong>{message.attendanceRecorded?`You’re checked in, ${firstName}`:`Welcome back, ${firstName}`}</strong><span>{message.attendanceRecorded?"CHECKED IN":"Already checked in"}</span><small>{locations.find(item=>item.id===locationId)?.name} · {timestamp?new Date(timestamp).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Arrival recorded"}</small></> : message ? <><span className="club-checkin-mark">!</span><strong>Access not approved</strong><span>{reasonLabel[message.reason??""]??"Please speak to reception"}</span></> : localError ? <><span className="club-checkin-mark">!</span><strong>Try again</strong><span>{localError}</span></> : <><span className="club-checkin-mark">⌁</span><strong>Ready to scan</strong><span>Hold your member QR code under the scanner</span></>}
    </section>
    <input ref={inputRef} className="club-checkin-scan-input" aria-label="Member QR scanner input" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={36} value={token} disabled={pending} onChange={event=>{setToken(event.target.value.replace(/[^a-z0-9-]/gi,""));setLocalError("");}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();submit();}}} onBlur={event=>{if(!(event.relatedTarget instanceof HTMLElement&&event.relatedTarget.closest("[data-station-settings]")))focusScan();}} />
    <footer>{pending?"Checking access…":"Scanner ready · R12 QR only"}</footer>
  </main>;
}

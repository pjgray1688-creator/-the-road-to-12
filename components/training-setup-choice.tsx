"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell, PageHeader, Surface } from "@/components/ui";

type Choice = "r12" | "manual" | "coach" | "skip";
type CoachState = { state?: "none" | "awaiting" | "assigned"; coachName?: string; title?: string; programme?: { week?: unknown[] } };
const options: Array<{ id: Choice; title: string; description: string }> = [
  { id: "r12", title: "Create my programme with R12", description: "Answer a few questions and get a programme matched to your goals and equipment." },
  { id: "manual", title: "I’ll build my own programme", description: "Choose your training days and exercises, then set your own targets." },
  { id: "coach", title: "My coach will set my programme", description: "View a plan assigned through your existing R12 Coach connection." },
  { id: "skip", title: "Skip training setup", description: "Continue to your account and gym features. You can set up training later." },
];

export function TrainingSetupChoice() {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>(); const [coach, setCoach] = useState<CoachState>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/training-setup", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(v => { if (["r12", "manual", "coach", "skip"].includes(v?.choice)) setChoice(v.choice); }).catch(() => undefined); }, []);
  async function choose(value: Choice) {
    setBusy(true); setError("");
    try { const response = await fetch("/api/training-setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: value }) }); if (!response.ok) throw new Error(); setChoice(value);
      if (value === "r12") router.push("/onboarding/create");
      else if (value === "manual") router.push("/onboarding/manual");
      else if (value === "skip") router.push("/member-hub");
      else { const result = await fetch("/api/training-coach-plan", { cache: "no-store" }); setCoach(result.ok ? await result.json() : { state: "none" }); }
    } catch { setError("Your choice could not be saved. Please try again."); } finally { setBusy(false); }
  }
  return <AppShell className="module-page training-setup-page"><PageHeader eyebrow="TRAINING · SETUP" title="How would you like to train?" description="Choose what works for you. You can change this later; your programme and workout history stay saved." />
    <div className="training-choice-list">{options.map(item => <button type="button" key={item.id} className={`training-choice${choice === item.id ? " selected" : ""}`} disabled={busy} onClick={() => void choose(item.id)}><span><strong>{item.title}</strong><small>{item.description}</small></span><b aria-hidden="true">→</b></button>)}</div>
    {error ? <p role="alert" className="error-text">{error}</p> : null}
    {choice === "coach" && <Surface className="coach-plan-state" aria-live="polite"><span className="eyebrow">COACH-ASSIGNED PROGRAMME</span>{!coach ? <p>Checking your Coach connection…</p> : coach.state === "assigned" ? <><h2>{coach.title ?? "Your assigned programme"}</h2><p>{coach.coachName ? `Assigned by ${coach.coachName}.` : "Your coach has assigned this plan."} Open Training to view sessions and log workouts.</p><Link className="primary" href="/training">Open Training →</Link></> : coach.state === "awaiting" ? <><h2>Waiting for your coach</h2><p>{coach.coachName ? `${coach.coachName} is connected.` : "Your Coach connection is being confirmed."} Your plan will appear here when your primary coach activates it.</p></> : <><h2>No coach connected</h2><p>There is no active Coach connection on this R12 account. Connect with a coach through the existing Coach invitation flow, or choose another training option.</p><Link className="member-hub-link" href="/account">Account and connections</Link></>}</Surface>}
    <Link className="text-button" href="/">Back to Training Home</Link><AppNav />
  </AppShell>;
}

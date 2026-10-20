"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { loadData, saveData, setStorageUserId } from "@/lib/storage";
import { hasAssignedTrainingProgramme } from "@/lib/training-entry";

const AssignedProgramme = createContext(false);
export const useHasAssignedTrainingProgramme = () => useContext(AssignedProgramme);

export function TrainingStorageBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [assigned, setAssigned] = useState(false);
  useEffect(() => {
    setStorageUserId(userId);
    let alive = true;
    const { data: listener } = browserSupabase().auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== userId) {
        setStorageUserId(null);
        window.location.replace("/account?mode=signIn");
      }
    });
    void (async () => {
      try {
        const response = await fetch("/api/training-profile", { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401) { window.location.replace("/account?mode=signIn"); return; }
        if (!response.ok) throw new Error("Training profile unavailable");
        const profile = await response.json();
        const hasProgramme = hasAssignedTrainingProgramme(profile);
        if (alive) setAssigned(hasProgramme);
        if (hasProgramme) {
          const local = loadData();
          saveData({ ...local, trainingProfile: profile.training_profile, ...(profile.generated_programme ? { generatedProgramme: profile.generated_programme } : {}), activeProgrammeId: profile.active_programme_id });
        }
        const stateResponse = await fetch("/api/training-state", { credentials: "same-origin", cache: "no-store" });
        if (stateResponse.status === 401) { window.location.replace("/account?mode=signIn"); return; }
        if (!stateResponse.ok) throw new Error("Training state unavailable");
        const trainingState = await stateResponse.json();
        const latest = loadData();
        saveData({ ...latest, sessionStatusOverrides: trainingState.sessionStatusOverrides ?? latest.sessionStatusOverrides, salvageAdjustments: trainingState.salvageAdjustments ?? latest.salvageAdjustments });
        if (alive) setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [userId]);
  if (status === "loading") return <main className="shell auth-splash" aria-busy="true"><p>Loading your training…</p></main>;
  if (status === "error") return <main className="shell auth-splash"><p>Your training is temporarily unavailable.</p><a className="secondary" href="/account">Account</a><a className="secondary" href="/member-hub">Gym Member Area</a></main>;
  return <AssignedProgramme.Provider value={assigned}>{children}</AssignedProgramme.Provider>;
}

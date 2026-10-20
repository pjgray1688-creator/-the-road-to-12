"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { loadData, saveData, setStorageUserId } from "@/lib/storage";
import { hasAssignedTrainingProgramme } from "@/lib/training-entry";

const AssignedProgrammeContext = createContext(false);
export function useHasAssignedTrainingProgramme() { return useContext(AssignedProgrammeContext); }

export function TrainingStorageBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [hasProgramme, setHasProgramme] = useState(false);
  useEffect(() => {
    setStorageUserId(userId);
    let alive = true;
    const supabase = browserSupabase();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== userId) {
        setStorageUserId(null);
        window.location.replace("/account?mode=signIn");
      }
    });
    void (async () => {
      try {
        const profileResponse = await fetch("/api/training-profile", { credentials: "same-origin", cache: "no-store" });
        if (profileResponse.status === 401) { window.location.replace("/account?mode=signIn"); return; }
        if (!profileResponse.ok) throw new Error("Training profile unavailable");
        const profile = await profileResponse.json();
        const assigned = hasAssignedTrainingProgramme(profile);
        if (alive) setHasProgramme(assigned);
        const data = loadData();
        if (hasAssignedTrainingProgramme(profile)) {
          saveData({ ...data, trainingProfile: profile.training_profile, ...(profile.generated_programme ? { generatedProgramme: profile.generated_programme } : { generatedProgramme: undefined }), activeProgrammeId: profile.active_programme_id });
        }
        const stateResponse = await fetch("/api/training-state", { credentials: "same-origin", cache: "no-store" });
        if (stateResponse.status === 401) { window.location.replace("/account?mode=signIn"); return; }
        if (!stateResponse.ok) throw new Error("Training state unavailable");
        const trainingState = await stateResponse.json();
        const latest = loadData();
        saveData({ ...latest, sessionStatusOverrides: trainingState.sessionStatusOverrides ?? latest.sessionStatusOverrides, salvageAdjustments: trainingState.salvageAdjustments ?? latest.salvageAdjustments });
        if (alive) setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [userId]);

  if (state === "loading") return <main className="shell auth-splash" aria-busy="true"><p>Loading your training…</p></main>;
  if (state === "error") return <main className="shell auth-splash"><p>Your training is temporarily unavailable. Please try again.</p></main>;
  return <AssignedProgrammeContext.Provider value={hasProgramme}>{children}</AssignedProgrammeContext.Provider>;
}

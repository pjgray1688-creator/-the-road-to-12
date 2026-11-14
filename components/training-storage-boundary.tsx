"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { loadData, saveData, setStorageUserId } from "@/lib/storage";
import { hasAssignedTrainingProgramme } from "@/lib/training-entry";

const AssignedProgrammeContext = createContext<boolean | null>(null);
const TrainingProfileErrorContext = createContext(false);
export function useHasAssignedTrainingProgramme() { return useContext(AssignedProgrammeContext); }
export function useTrainingProfileLoadFailed() { return useContext(TrainingProfileErrorContext); }

/**
 * Training profile and workout state are secondary app data. Render the
 * authenticated route immediately and hydrate these independently so a slow
 * training request cannot hold the Member shell or its navigation hostage.
 */
export function TrainingStorageBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [hasProgramme, setHasProgramme] = useState<boolean | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);

  useEffect(() => {
    setStorageUserId(userId);
    let alive = true;
    const supabase = browserSupabase();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== userId)) {
        setStorageUserId(null);
        window.location.replace("/account?mode=signIn");
      }
    });

    const loadProfile = async () => {
      try {
        const response = await fetch("/api/training-profile", { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401) { window.location.replace("/account?mode=signIn"); return; }
        if (!response.ok) throw new Error("Training profile unavailable");
        const profile = await response.json();
        if (!alive) return;
        const assigned = hasAssignedTrainingProgramme(profile);
        const data = loadData();
        if (assigned) {
          saveData({
            ...data,
            trainingProfile: profile.training_profile,
            ...(profile.generated_programme ? { generatedProgramme: profile.generated_programme } : { generatedProgramme: undefined }),
            activeProgrammeId: profile.active_programme_id,
          });
        }
        setHasProgramme(assigned);
        setProfileLoadFailed(false);
      } catch {
        if (alive) setProfileLoadFailed(true);
      }
    };

    const loadTrainingState = async () => {
      const response = await fetch("/api/training-state", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { window.location.replace("/account?mode=signIn"); return; }
      if (!response.ok) return;
      const trainingState = await response.json();
      if (!alive) return;
      const latest = loadData();
      saveData({
        ...latest,
        sessionStatusOverrides: trainingState.sessionStatusOverrides ?? latest.sessionStatusOverrides,
        salvageAdjustments: trainingState.salvageAdjustments ?? latest.salvageAdjustments,
      });
    };

    // These requests do not depend on one another. Neither blocks children.
    void Promise.allSettled([loadProfile(), loadTrainingState()]);
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [userId]);

  return <AssignedProgrammeContext.Provider value={hasProgramme}><TrainingProfileErrorContext.Provider value={profileLoadFailed}>{children}</TrainingProfileErrorContext.Provider></AssignedProgrammeContext.Provider>;
}

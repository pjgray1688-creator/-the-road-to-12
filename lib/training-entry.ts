export type TrainingAccountState = {
  training_profile?: unknown;
  generated_programme?: unknown;
  active_programme_id?: unknown;
};

export function hasAssignedTrainingProgramme(state: TrainingAccountState | null | undefined) {
  if (!state || !state.training_profile || typeof state.training_profile !== "object") return false;
  if (state.active_programme_id === "legacy-personal-programme") return true;
  if (!state.generated_programme || typeof state.generated_programme !== "object") return false;
  const generated = state.generated_programme as { id?: unknown };
  return typeof generated.id === "string" && generated.id.length > 0 && state.active_programme_id === generated.id;
}

export function signInDestination(path: string) {
  return `/account?mode=signIn&next=${encodeURIComponent(path)}`;
}


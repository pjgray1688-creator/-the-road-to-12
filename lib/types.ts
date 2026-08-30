export type SetKind = "warmup" | "working";
export type Exercise = { id: string; name: string; target: string; sets: number; restSeconds: number; purpose: "strength" | "hypertrophy" | "isolation" | "core"; };
export type LoggedSet = { id: string; exerciseId: string; exerciseName: string; weight: number; reps: number; rir: number; kind: SetKind; createdAt: string; };
export type Cardio = { duration: number; incline: number; speed: number; completedAt?: string; };
export type Workout = { id: string; startedAt: string; completedAt?: string; name: string; sets: LoggedSet[]; substitutions: Record<string, string>; cardio?: Cardio; notes: string[]; };
export type AppData = { version: 1; workouts: Workout[]; bodyMetrics: { date: string; bodyweight?: number; waist?: number }[]; meals: unknown[]; };
export type Recommendation = { title: string; detail: string; nextWeight: number; repTarget: string; restSeconds: number; tone: "progress" | "hold" | "reduce"; };

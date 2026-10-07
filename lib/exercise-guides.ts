import manifest from "../data/exercise-guides.json";
import { exerciseKnowledge, resolveExerciseId } from "./exercise-library";

export const guideMuscleRegions = ["upper_chest", "mid_lower_chest", "anterior_delt", "lateral_delt", "rear_delt", "biceps", "triceps", "forearms", "traps", "lats", "upper_back", "spinal_erectors", "abs", "obliques", "glutes", "hip_flexors", "adductors", "abductors", "quads", "hamstrings", "calves"] as const;
export type GuideMuscleRegion = typeof guideMuscleRegions[number];
export type GuideMediaStatus = "video" | "static" | "written" | "manual_review" | "unavailable";
export type GuideReviewStatus = "approved" | "manual_review" | "unavailable";
export type GuideQaStatus = "approved" | "pending" | "rejected";
export type ExerciseGuideContent = {
  exerciseId: string;
  guideVersion: number;
  mediaStatus: GuideMediaStatus;
  video?: { webm?: string; mp4?: string; poster?: string };
  poster?: string;
  cameraView?: string;
  durationSeconds?: number;
  primaryMuscles: GuideMuscleRegion[];
  secondaryMuscles: GuideMuscleRegion[];
  stabilisers?: GuideMuscleRegion[];
  equipment: string[];
  setupCue?: string;
  formCues: string[];
  commonMistakes: string[];
  movementDescription?: string;
  reviewStatus: GuideReviewStatus;
  qaStatus: GuideQaStatus;
  assetVersion?: string;
  publishedAt?: string;
};

const guideMap = new Map((manifest as ExerciseGuideContent[]).map(item => [item.exerciseId, item]));
const validMuscles = new Set<string>(guideMuscleRegions);
const validMedia = new Set<GuideMediaStatus>(["video", "static", "written", "manual_review", "unavailable"]);
const validReview = new Set<GuideReviewStatus>(["approved", "manual_review", "unavailable"]);
const validQa = new Set<GuideQaStatus>(["approved", "pending", "rejected"]);

export function getExerciseGuide(exerciseId: string): ExerciseGuideContent | undefined {
  const canonicalId = resolveExerciseId(exerciseId);
  return canonicalId ? guideMap.get(canonicalId) : undefined;
}

export const resolveExerciseGuide = getExerciseGuide;
export function hasExerciseGuide(exerciseId: string) {
  const guide = getExerciseGuide(exerciseId);
  return Boolean(guide && guide.mediaStatus !== "unavailable" && (guide.reviewStatus === "approved" || guide.mediaStatus === "written"));
}
export function exerciseGuideManifest() { return Array.from(guideMap.values()); }

export function validateExerciseGuideManifest(entries: unknown = manifest): string[] {
  const errors: string[] = [];
  if (!Array.isArray(entries)) return ["guide manifest must be an array"];
  const versions = new Set<string>();
  for (const raw of entries) {
    const item = raw as Partial<ExerciseGuideContent>;
    if (!item || typeof item !== "object") { errors.push("guide entry must be an object"); continue; }
    if (typeof item.exerciseId !== "string" || !item.exerciseId.trim()) { errors.push("guide exerciseId is required"); continue; }
    const key = `${item.exerciseId}:${item.guideVersion}`;
    if (versions.has(key)) errors.push(`duplicate guide version: ${key}`);
    versions.add(key);
    const canonical = resolveExerciseId(item.exerciseId);
    if (!canonical) errors.push(`unknown exercise id: ${item.exerciseId}`);
    if (canonical !== item.exerciseId) errors.push(`guide must be keyed by canonical id: ${item.exerciseId} -> ${canonical}`);
    if (!validMedia.has(item.mediaStatus as GuideMediaStatus)) errors.push(`invalid media status on ${item.exerciseId}`);
    if (!validReview.has(item.reviewStatus as GuideReviewStatus)) errors.push(`invalid review status on ${item.exerciseId}`);
    if (!validQa.has(item.qaStatus as GuideQaStatus)) errors.push(`invalid QA status on ${item.exerciseId}`);
    if (!Number.isInteger(item.guideVersion) || (item.guideVersion as number) < 1) errors.push(`invalid guide version on ${item.exerciseId}`);
    for (const region of [...(item.primaryMuscles ?? []), ...(item.secondaryMuscles ?? []), ...(item.stabilisers ?? [])]) if (!validMuscles.has(region)) errors.push(`invalid muscle region ${region} on ${item.exerciseId}`);
    if (!Array.isArray(item.primaryMuscles) || item.primaryMuscles.length === 0) errors.push(`primary muscles required on ${item.exerciseId}`);
    if (!Array.isArray(item.formCues) || item.formCues.length < 1 || item.formCues.length > 4) errors.push(`form cues must contain 1-4 items on ${item.exerciseId}`);
    if (!Array.isArray(item.commonMistakes) || item.commonMistakes.length > 4) errors.push(`common mistakes must contain 0-4 items on ${item.exerciseId}`);
    for (const text of [...(item.formCues ?? []), ...(item.commonMistakes ?? [])]) if (typeof text !== "string" || text.length > 240) errors.push(`guide cue is invalid or too long on ${item.exerciseId}`);
    const videoUrl = item.video?.webm || item.video?.mp4;
    if (item.mediaStatus === "video" && !videoUrl) errors.push(`video media requires a video URL on ${item.exerciseId}`);
    if (item.mediaStatus !== "video" && item.video) errors.push(`non-video guide cannot claim video media on ${item.exerciseId}`);
    if (item.mediaStatus === "static" && !item.poster) errors.push(`static media requires a poster on ${item.exerciseId}`);
    if (item.mediaStatus === "unavailable" && (item.formCues?.length || item.movementDescription)) errors.push(`unavailable guide contains user content on ${item.exerciseId}`);
    if (item.publishedAt && Number.isNaN(Date.parse(item.publishedAt))) errors.push(`invalid publishedAt on ${item.exerciseId}`);
    const knowledge = canonical ? exerciseKnowledge(canonical) : undefined;
    if (!knowledge) errors.push(`guide exercise cannot resolve in catalogue: ${item.exerciseId}`);
  }
  return errors;
}

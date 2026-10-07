import source from "../data/exercise-library.json";
import compatibilitySource from "../data/exercise-library-legacy-compat.json";

export type PrescriptionMetric = "reps" | "load" | "time" | "distance" | "calories" | "pace" | "heartRate" | "heartRateZone" | "RPE" | "RIR" | "rounds" | "cadence" | "incline" | "speed";
export type ExerciseReviewStatus = "reviewed-candidate" | "manual-review";
export type ExerciseProgrammeRole = "primary_compound" | "secondary_compound" | "isolation" | "accessory";
export type ExerciseResolutionContext = { displayName?: string; equipment?: string };

export type ExerciseKnowledge = {
  id: string; name: string; aliases: string[]; primaryMuscles: string[]; secondaryMuscles: string[]; movementPattern: string; equipment: string;
  equipmentRequired: string[]; equipmentOptional: string[]; laterality: "bilateral" | "unilateral"; unilateral: boolean; compound: boolean;
  compoundOrIsolation: "compound" | "isolation"; stabilityDemand: "low" | "medium" | "high"; jointDemands: string[];
  axialLoading: "none" | "low" | "medium" | "high"; kneeDemand: "none" | "low" | "medium" | "high"; hipHingeDemand: "none" | "low" | "medium" | "high"; shoulderDemand: "low" | "medium" | "high";
  emphasis: string[]; programmeRole: ExerciseProgrammeRole; researchProgrammeRole: string; repRange: string; loadingPattern: string; progression: string;
  regressionOptions: string[]; progressionOptions: string[]; substitutions: string[]; cautions: string[]; intent: string[]; trainingStyles: string[]; sessionStructures: string[];
  supportedPrescriptionMetrics: PrescriptionMetric[]; exerciseFamily: string; variant: string; category: string; reviewStatus: ExerciseReviewStatus; provenance: string;
};

type ResearchExercise = {
  id: string; canonicalName: string; aliases: string[]; exerciseFamily: string; variant: string; category: string; primaryMuscles: string[]; secondaryMuscles: string[]; movementPattern: string;
  equipmentRequired: string[]; equipmentOptional: string[]; laterality: "bilateral" | "unilateral"; compoundOrIsolation: "compound" | "isolation"; programmeRole: string; trainingIntent: string[];
  stabilityDemand: "low" | "medium" | "high"; axialLoad: "none" | "low" | "medium" | "high"; kneeDemand: "none" | "low" | "medium" | "high"; hipHingeDemand: "none" | "low" | "medium" | "high"; shoulderDemand: "low" | "medium" | "high";
  jointDemands: string[]; typicalRepRange: string; supportedPrescriptionMetrics: PrescriptionMetric[]; loadingPattern: string; progressionApproach: string; regressionOptions: string[]; progressionOptions: string[]; substitutions: string[]; cautions: string[];
  suitableTrainingStyles: string[]; suitableSessionStructures: string[]; provenance: string; reviewStatus: ExerciseReviewStatus;
};
type ResearchSource = { schemaVersion: string; catalogue: ResearchExercise[]; legacyIdMappings: Array<{ legacyId: string; supersededBy: string; resolution: string; preserveForHistoricalLookup: boolean }> };
const catalogueSource = source as ResearchSource;
const compatibilityById = new Map((compatibilitySource as Array<Partial<ExerciseKnowledge> & { id: string }>).map(item => [item.id, item]));

function legacyRole(value: string, compound: boolean): ExerciseProgrammeRole {
  if (/isolation/i.test(value) || !compound) return "isolation";
  if (/primary/i.test(value)) return "primary_compound";
  if (/secondary/i.test(value)) return "secondary_compound";
  return "accessory";
}
function toKnowledge(item: ResearchExercise): ExerciseKnowledge {
  const equipment = item.equipmentRequired[0] ?? "other";
  const compatibility = compatibilityById.get(item.id);
  return { id: item.id, name: item.canonicalName, aliases: item.aliases, primaryMuscles: item.primaryMuscles, secondaryMuscles: item.secondaryMuscles, movementPattern: item.movementPattern, equipment,
    equipmentRequired: item.equipmentRequired, equipmentOptional: item.equipmentOptional, laterality: item.laterality, unilateral: item.laterality === "unilateral", compound: item.compoundOrIsolation === "compound", compoundOrIsolation: item.compoundOrIsolation,
    stabilityDemand: item.stabilityDemand, jointDemands: item.jointDemands, axialLoading: item.axialLoad, kneeDemand: item.kneeDemand, hipHingeDemand: item.hipHingeDemand, shoulderDemand: item.shoulderDemand,
    emphasis: item.trainingIntent, programmeRole: legacyRole(item.programmeRole, item.compoundOrIsolation === "compound"), researchProgrammeRole: item.programmeRole, repRange: item.typicalRepRange, loadingPattern: item.loadingPattern, progression: item.progressionApproach,
    regressionOptions: item.regressionOptions, progressionOptions: item.progressionOptions, substitutions: item.substitutions, cautions: item.cautions, intent: item.trainingIntent, trainingStyles: item.suitableTrainingStyles, sessionStructures: item.suitableSessionStructures,
    supportedPrescriptionMetrics: item.supportedPrescriptionMetrics, exerciseFamily: item.exerciseFamily, variant: item.variant, category: item.category, reviewStatus: item.reviewStatus, provenance: item.provenance, ...(compatibility ?? {}) };
}

/** One static source is transformed once; callers never rescan the JSON. */
export const exerciseLibrary: ExerciseKnowledge[] = catalogueSource.catalogue.map(toKnowledge);
export const legacyExerciseMappings = catalogueSource.legacyIdMappings;
export const exerciseLibraryVersion = catalogueSource.schemaVersion;
const byId = new Map(exerciseLibrary.map(item => [item.id, item]));
const aliasToId = new Map<string, string>();
const legacyToId = new Map(legacyExerciseMappings.map(item => [item.legacyId, item.supersededBy]));
function normalize(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
for (const item of exerciseLibrary) for (const alias of item.aliases) { const key = normalize(alias); if (key && !aliasToId.has(key)) aliasToId.set(key, item.id); }

/** Resolve saved IDs at use-time; persisted historical workout rows are untouched. */
export function resolveExerciseId(id: string, context: ExerciseResolutionContext = {}): string | undefined {
  if (byId.has(id)) return id;
  const aliasId = aliasToId.get(normalize(id));
  if (aliasId) return aliasId;
  let resolved = legacyToId.get(id);
  if (!resolved) return undefined;
  if (id === "vertical-pull") { const savedText = `${context.displayName ?? ""} ${context.equipment ?? ""}`; resolved = /assisted|band|machine/i.test(savedText) ? "assisted-pull-up" : "pull-up"; }
  const seen = new Set<string>();
  while (!byId.has(resolved) && legacyToId.has(resolved) && !seen.has(resolved)) { seen.add(resolved); resolved = legacyToId.get(resolved) as string; }
  return byId.has(resolved) ? resolved : undefined;
}
export function exerciseKnowledge(id: string, context?: ExerciseResolutionContext) { const resolved = resolveExerciseId(id, context); return resolved ? byId.get(resolved) : undefined; }

export type ExerciseFilters = { equipment?: string | string[]; muscle?: string | string[]; movementPattern?: string | string[]; trainingStyle?: string | string[]; programmeRole?: string | string[]; compoundOrIsolation?: "compound" | "isolation"; laterality?: "bilateral" | "unilateral"; reviewStatus?: ExerciseReviewStatus };
function values(value?: string | string[]) { return (Array.isArray(value) ? value : value ? [value] : []).map(normalize); }
function includesFilter(valuesToCheck: string[], filter?: string | string[]) { const wanted = values(filter); return !wanted.length || wanted.some(item => valuesToCheck.map(normalize).includes(item)); }
export function filterExercises(filters: ExerciseFilters = {}) { return exerciseLibrary.filter(item => includesFilter(item.equipmentRequired, filters.equipment) && includesFilter([...item.primaryMuscles, ...item.secondaryMuscles], filters.muscle) && includesFilter([item.movementPattern], filters.movementPattern) && includesFilter(item.trainingStyles, filters.trainingStyle) && includesFilter([item.programmeRole, item.researchProgrammeRole], filters.programmeRole) && (!filters.compoundOrIsolation || item.compoundOrIsolation === filters.compoundOrIsolation) && (!filters.laterality || item.laterality === filters.laterality) && (!filters.reviewStatus || item.reviewStatus === filters.reviewStatus)); }
export function searchExercises(query: string, filters: ExerciseFilters = {}) {
  const search = normalize(query); const tokens = search.split(" ").filter(Boolean);
  return filterExercises(filters).map((item, index) => { const name = normalize(item.name); const aliases = item.aliases.map(normalize); const metadata = normalize([...item.primaryMuscles, ...item.secondaryMuscles, item.movementPattern, ...item.equipmentRequired, ...item.trainingStyles, item.programmeRole].join(" ")); let score = 0;
    if (!search) score = 1; else if (name === search) score = 1000; else if (aliases.includes(search)) score = 900; else if (name.startsWith(search)) score = 800; else if (aliases.some(alias => alias.startsWith(search))) score = 700; else if (tokens.length && tokens.every(token => name.split(" ").includes(token))) score = 600; else if (tokens.length && tokens.every(token => metadata.includes(token))) score = 300;
    return { item, score, index }; }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name) || a.index - b.index).map(result => result.item);
}

export function validateExerciseCatalogue() {
  const errors: string[] = []; const ids = new Set<string>(); const names = new Map<string, string>(); const aliases = new Map<string, string>();
  const validMetrics = new Set<PrescriptionMetric>(["reps", "load", "time", "distance", "calories", "pace", "heartRate", "heartRateZone", "RPE", "RIR", "rounds", "cadence", "incline", "speed"]);
  const structures = new Set(["straight-sets", "superset", "triset", "giant-set", "circuit", "drop-set", "mechanical-drop-set", "rest-pause", "cluster", "AMRAP", "EMOM", "intervals", "density-block", "finisher", "rounds", "tempo-scheme", "warm-up", "mobility-block", "cool-down", "skill-block"]);
  for (const item of catalogueSource.catalogue) { const name = normalize(item.canonicalName); if (!name || names.has(name)) errors.push(`duplicate canonical name: ${item.canonicalName}`); names.set(name, item.id); }
  for (const item of catalogueSource.catalogue) {
    if (ids.has(item.id)) errors.push(`duplicate id: ${item.id}`); ids.add(item.id);
    for (const alias of item.aliases) { const key = normalize(alias); if (names.has(key) && names.get(key) !== item.id) errors.push(`alias collides with canonical name: ${alias}`); if (aliases.has(key) && aliases.get(key) !== item.id) errors.push(`alias collision: ${alias}`); aliases.set(key, item.id); }
    for (const metric of item.supportedPrescriptionMetrics) if (!validMetrics.has(metric)) errors.push(`invalid metric ${metric} on ${item.id}`);
    for (const structure of item.suitableSessionStructures) if (!structures.has(structure)) errors.push(`invalid session structure ${structure} on ${item.id}`);
    if ([item.id, item.canonicalName, ...item.aliases].some(value => structures.has(value))) errors.push(`session structure treated as exercise: ${item.id}`);
    for (const ref of [...item.substitutions, ...item.progressionOptions, ...item.regressionOptions]) if (!ids.has(ref) && !catalogueSource.catalogue.some(candidate => candidate.id === ref)) errors.push(`unresolved reference ${ref} from ${item.id}`);
  }
  for (const mapping of legacyExerciseMappings) if (!ids.has(mapping.supersededBy)) errors.push(`unresolved legacy mapping ${mapping.legacyId} -> ${mapping.supersededBy}`);
  return errors;
}

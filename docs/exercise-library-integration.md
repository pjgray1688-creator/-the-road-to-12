# Exercise library integration

R12 now keeps one versioned static source at `data/exercise-library.json`. It is the reviewed 1,579-definition research catalogue copied into the application repository. `data/exercise-library-legacy-compat.json` is a small compatibility overlay for the existing 92 runtime knowledge records; it preserves current cues, substitutions and progression semantics while the richer catalogue fields are adopted.

`lib/exercise-library.ts` transforms the JSON once at module load and builds indexes for canonical IDs, aliases and legacy mappings. Consumers should use:

- `resolveExerciseId(id, context)` at read/use boundaries. Stored workout IDs are never rewritten.
- `exerciseKnowledge(id, context)` for one resolved definition.
- `searchExercises(query, filters)` for ranked interactive search.
- `filterExercises(filters)` for composable catalogue filtering.
- `validateExerciseCatalogue()` for deterministic contract validation.

Legacy `vertical-pull` uses saved display/equipment context: assisted, band or machine context resolves to `assisted-pull-up`; otherwise it resolves to `pull-up`. Other legacy mappings follow the reviewed `supersededBy` map.

Prescription metrics and session structures remain metadata, not exercise identity. A future programme builder should store a canonical exercise ID plus a separate prescription/session-structure object. Manual-review entries remain in the catalogue and can later be flagged or gated by product policy.

Future custom exercises should use a separate namespace such as `custom:{coach-or-organisation-id}:{uuid}` and should never share system canonical IDs. Organisation-private custom definitions should be resolved through a separate scoped repository layer, not appended to the system JSON.

Run `npm run exercise-library:validate` before changing the catalogue. It checks IDs, canonical names, alias collisions, references, metrics, session structures, legacy mappings and the separation of session-structure terms from exercise identities.

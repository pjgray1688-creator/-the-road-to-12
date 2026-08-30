# Development guide

## Architecture

- `app/` contains the Next.js App Router shell, PWA manifest, and server-side Coach API boundary.
- `components/` contains mobile UI pieces. `training-app.tsx` owns the active-session UI state.
- `lib/types.ts` is the durable domain model. Keep new tracking concepts additive here.
- `lib/storage.ts` is a versioned local-storage adapter. Replace it with an authenticated repository implementation without changing UI domain types.
- `lib/coach.ts` is deterministic, local coaching logic. Future OpenAI calls belong in `app/api/coach`, never client code.

## Workflow

1. Run `npm run lint`, `npm test`, and `npm run build` before handoff.
2. Keep all changes mobile-first; minimum touch targets are 44px and maintain high contrast.
3. Preserve the coaching philosophy: recommend an action with a reason; never automatically increase load just because a rep target was reached.
4. Make migration-safe changes to persisted `AppData`; bump its version and add a migration when its shape changes.
5. Verify the complete flow after changing workout UX: start → warm-up → working set → rest → coach advice → cardio → finish → export.

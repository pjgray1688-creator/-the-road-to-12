# THE ROAD TO 12%

A mobile-first personal training PWA for logging training quality, recovering intelligently, and progressing without blindly chasing weight.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. On iPhone Safari, use **Share → Add to Home Screen**. The app stores training data locally in the browser, so it works immediately without an account.

## Verify and deploy

```bash
npm run lint
npm test
npm run build
```

Deploy by importing this repository into Vercel, or run `vercel` after installing and logging into the Vercel CLI. No environment variables are required in V1.

## V1 capabilities

- Complete Monday Upper Push + Core workout and Coach-selected treadmill finish
- Warm-up/working set logs, RIR, previous performance, substitutions, rest timer and vibration
- Rule-based Coach that prioritises technique, quality volume, fatigue and sensible progression
- Persistent local browser storage; a server-side `/api/coach` boundary for future secure AI integration
- Copy-ready Whoop export that contains only logged working sets and cardio

## Data direction

`AppData` already models workout history, set history, cardio, body metrics and meals. The next production step is replacing browser-only storage with authenticated database persistence, then adding integrations behind server-side routes. API keys must remain server-side.

## Current architecture foundation

- Records are tagged `real`, `test`, or `historical`; the dashboard’s **Reset Test Data** only removes test-tagged workouts, nutrition and measurements.
- The current seven-day block, planned/rest/recovery status and reason model are in `lib/domain.ts`.
- Genuine known training references are imported in `lib/historical-data.ts` with confidence labels; unknown dates or RIR are not invented.
- See [docs/integrations.md](docs/integrations.md) for the real WHOOP OAuth and Apple Health native-bridge requirements.

## WHOOP connection (optional)

Create an application in the [WHOOP Developer Dashboard](https://developer.whoop.com/), set the callback URL to `http://localhost:3000/api/integrations/whoop/callback` for local development (and the equivalent deployed URL), then copy the client ID and secret into server-only `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_REDIRECT_URI` variables. Restart the app and choose Connect WHOOP from Readiness. The app requests `offline`, `read:recovery`, `read:sleep`, `read:cycles`, and `read:workout`; tokens remain server-side. Sync imports only metrics returned by WHOOP (recovery score, HRV, resting heart rate, strain and timestamps). Apple Health remains a native iOS bridge requirement; this PWA does not claim browser HealthKit access.

## Vercel deployment

Deploy the repository as a Next.js project through Vercel. Configure the server environment variables from `.env.example` in the Vercel project settings; never commit secrets. Set `WHOOP_REDIRECT_URI` to `https://PRODUCTION_DOMAIN/api/integrations/whoop/callback`, and add that exact URL to the WHOOP Developer Dashboard. The public privacy policy will be `https://PRODUCTION_DOMAIN/privacy`. Terms are available at `https://PRODUCTION_DOMAIN/terms`. Local development can continue using the localhost callback in `.env.local`.

## Accounts and database foundation

The production account/database boundary uses Supabase Auth + Postgres with row-level security. Create a Supabase project, run `supabase/schema.sql`, and configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`/`WHOOP_TOKEN_ENCRYPTION_KEY` as required by the deployment. The `/account` route provides sign-in/sign-up; protected server routes validate the Supabase session. The existing local-first owner data remains in the browser until the one-time `/api/account/migrate` migration action is completed and verified. Test-origin records are excluded and the migration payload has a deterministic idempotency key. Apple Health remains a native bridge boundary; no browser HealthKit access is attempted.

### WHOOP persistence migration

Before deploying the persistent WHOOP integration, run `supabase/migrations/2026-08-30-whoop-persistence.sql` against the existing Supabase project (the full schema is in `supabase/schema.sql`). This adds the connection update timestamp and keeps token/record tables inaccessible to browser clients. Existing transient WHOOP authorizations cannot be migrated; reconnect once after deployment.

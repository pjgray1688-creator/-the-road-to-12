# Integrations

## WHOOP

The server boundary is ready at `/api/integrations/whoop`; it deliberately does not claim a connection. Create a WHOOP Developer Dashboard app, register the production callback URL, and set `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_REDIRECT_URI` as server-only environment variables. WHOOP uses OAuth 2.0, needs registered redirect URLs and scopes, and returns refresh tokens only with `offline`; store encrypted tokens server-side. Request only the recovery, sleep, cycles and workout scopes actually used. Persist imported data as `RecoverySnapshot`/activity records with source `whoop`.

## Apple Health

An installed PWA cannot directly call HealthKit. Add a small signed native iOS companion (Swift/HealthKit) or wrap the app before attempting this integration. It needs the HealthKit capability, `NSHealthShareUsageDescription`/`NSHealthUpdateUsageDescription`, and granular user permission for steps, active energy, workouts, heart rate, resting heart rate, sleep and body mass. The native bridge should upload normalized, user-approved samples to the backend as `RecoverySnapshot`/`BodyMeasurement` records; it must not transfer data until backend privacy/storage policy is in place.

export type CheckVenue = { id: string; active: boolean };

/** Select only venues already approved by the server's location authorization RPC. */
export function resolveCheckVenue(input: {
  locations: readonly CheckVenue[];
  authorizedLocationIds: ReadonlySet<string>;
  canReview: boolean;
  requestedLocationId?: string;
  scheduledLocationId?: string;
}) {
  const allowedLocations = input.locations.filter(location => location.active && (input.canReview || input.authorizedLocationIds.has(location.id)));
  const selected = input.requestedLocationId && allowedLocations.some(location => location.id === input.requestedLocationId)
    ? input.requestedLocationId
    : input.scheduledLocationId && allowedLocations.some(location => location.id === input.scheduledLocationId)
      ? input.scheduledLocationId
      : allowedLocations[0]?.id;
  return { allowedLocations, locationId: selected };
}

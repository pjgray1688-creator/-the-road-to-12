"use client";

import { useState, useTransition } from "react";
import { updateMemberHomeGymAction } from "@/app/club/members/[userId]/actions";

type Location = { id: string; name: string; active: boolean };
export function ClubMemberHomeGymControl({ organisationId, userId, locations, currentLocationId }: { organisationId: string; userId: string; locations: Location[]; currentLocationId?: string }) {
  const [locationId, setLocationId] = useState(currentLocationId ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () => startTransition(async () => {
    const result = await updateMemberHomeGymAction({ organisationId, userId, locationId });
    setMessage(result.ok ? `Home gym saved: ${result.locationName}.` : result.error);
  });
  return <div className="club-home-gym-control"><label>Home gym <select aria-label="Member home gym" value={locationId} onChange={event => { setLocationId(event.target.value); setMessage(""); }}><option value="">Not set</option>{locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><button type="button" className="secondary" onClick={save} disabled={pending || !locationId || locationId === currentLocationId}>{pending ? "Saving…" : "Save home gym"}</button>{message ? <small role="status">{message}</small> : null}<small>Used as an operational preference only. Membership access is unchanged.</small></div>;
}

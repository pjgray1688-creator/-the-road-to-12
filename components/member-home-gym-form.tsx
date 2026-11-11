"use client";

import { useState, useTransition } from "react";
import { saveMyMadhouseHomeGymAction } from "@/app/member-hub/profile/actions";

type HomeLocation = { id: string; name: string };

export function MemberHomeGymForm({ organisationId, locations, currentLocationId }: { organisationId: string; locations: HomeLocation[]; currentLocationId?: string }) {
  const [locationId, setLocationId] = useState(currentLocationId ?? "");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string }>();
  const [pending, startTransition] = useTransition();
  return <form className="member-home-gym-form" onSubmit={event => {
    event.preventDefault();
    setFeedback(undefined);
    startTransition(async () => {
      const result = await saveMyMadhouseHomeGymAction(organisationId, locationId);
      setFeedback(result.ok ? { ok: true, message: "Home gym saved." } : { ok: false, message: result.error });
    });
  }}>
    <label htmlFor="member-home-gym">Preferred home gym</label>
    <select id="member-home-gym" required value={locationId} onChange={event => setLocationId(event.target.value)}>
      <option value="">Choose a home gym</option>
      {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
    </select>
    <button className="primary" type="submit" disabled={pending || !locationId}>{pending ? "Saving…" : "Save home gym"}</button>
    {feedback ? <p role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}
  </form>;
}

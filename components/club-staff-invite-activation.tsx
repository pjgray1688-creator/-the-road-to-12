"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateExistingStaffAccessGrant } from "@/app/club/staff/actions";

export function ClubStaffInviteActivation({ organisationId, grantId }: { organisationId: string; grantId: string }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return <div className="staff-invite-activation">
    <button className="primary" type="button" disabled={pending} onClick={() => startTransition(async () => {
      setMessage("");
      const result = await activateExistingStaffAccessGrant({ organisationId, grantId });
      setMessage(result.ok ? "Existing account activated from this invitation." : result.error);
      if (result.ok) router.refresh();
    })}>{pending ? "Activating…" : "Activate existing account"}</button>
    {message ? <small role="status">{message}</small> : null}
  </div>;
}

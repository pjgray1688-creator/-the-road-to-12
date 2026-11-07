"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimStaffAccessGrant } from "@/app/club/staff/actions";

export function ClubStaffGrantAutoClaim({ grantId }: { grantId: string }) {
  const started = useRef(false);
  const [message, setMessage] = useState("Verifying the invitation and activating your staff access…");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(async () => {
      const result = await claimStaffAccessGrant(grantId);
      if (!result.ok) {
        setMessage(`${result.error} Confirm that you are signed in with the invited, verified email and that the invitation has not expired.`);
        return;
      }
      setMessage("Staff access is active. Loading your Club access…");
      router.refresh();
    });
  }, [grantId, router]);

  return <p role="status" aria-live="polite" aria-busy={pending}>{message}</p>;
}

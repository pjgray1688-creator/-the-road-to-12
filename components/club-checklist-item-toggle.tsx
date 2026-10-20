"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markChecklistItemCompleteAction } from "@/app/club/checks/actions";
import styles from "@/components/club-checks.module.css";

export function ClubChecklistItemToggle({ organisationId, locationId, itemId, note, initialComplete, canMark }: {
  organisationId: string; locationId: string; itemId: string; note?: string; initialComplete: boolean; canMark: boolean;
}) {
  const router = useRouter();
  const [complete, setComplete] = useState(initialComplete);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <span className={styles.checklistToggle}>
    <label><input type="checkbox" checked={complete} disabled={!canMark || complete || pending} onChange={() => {
      setError("");
      startTransition(async () => {
        const result = await markChecklistItemCompleteAction({ organisationId, locationId, itemId, note });
        if (result.ok) { setComplete(true); router.refresh(); }
        else setError(result.error);
      });
    }} /> {pending ? "Saving…" : complete ? "Done" : "Mark complete"}</label>
    {error ? <small role="alert">{error}</small> : null}
  </span>;
}

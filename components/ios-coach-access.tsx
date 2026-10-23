"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export function IosCoachAccess() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (document.documentElement.dataset.r12Shell !== "member-ios") return;
    let active = true;
    void fetch("/api/coach/access", { credentials: "same-origin" })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (active) setAllowed(Boolean(result?.allowed)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return allowed ? <Link className="navigation-row" href="/coach"><span><strong>Coach workspace</strong><small>Your coaching clients and programmes</small></span><b aria-hidden="true">›</b></Link> : null;
}

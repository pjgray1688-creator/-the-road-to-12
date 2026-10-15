import type { ReactNode } from "react";
import { CoachProductShell } from "@/components/coach-product-shell";

export default function CoachLayout({ children }: { children: ReactNode }) {
  return <CoachProductShell>{children}</CoachProductShell>;
}

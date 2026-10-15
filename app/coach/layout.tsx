import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CoachProductShell } from "@/components/coach-product-shell";

export const metadata: Metadata = { title: { default: "R12 Coach", template: "%s · R12 Coach" }, description: "R12 Coach workspace." };

export default function CoachLayout({ children }: { children: ReactNode }) {
  return <CoachProductShell>{children}</CoachProductShell>;
}

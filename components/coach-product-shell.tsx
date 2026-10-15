"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { brand } from "@/lib/brand";
import styles from "./coach-product-shell.module.css";
import { CoachNavigation } from "./coach-navigation";

export function CoachProductShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>
    <header className={styles.header}>
      <Link href="/coach" className={styles.brand} aria-label="R12 Coach home">
        <Image className={styles.brandMark} src={brand.markSrc} alt="" width={44} height={44} priority />
        <span className={styles.productLabel}>Coach</span>
      </Link>
      <Link href="/member-hub" className={styles.switcher}>Open R12 <span aria-hidden="true">↗</span></Link>
    </header>
    <CoachNavigation />
    <div className={styles.content}>{children}</div>
  </div>;
}

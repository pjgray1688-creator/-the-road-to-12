import type { Metadata } from "next";

export function clubTitle(page?: string, organisationName?: string) {
  const tenant = organisationName?.trim() ? `R12 × ${organisationName.trim()}` : "R12 Club";
  return page ? `${page} · ${tenant}` : tenant;
}

export function clubMetadata(page?: string, organisationName?: string): Metadata { return { title: clubTitle(page, organisationName) }; }

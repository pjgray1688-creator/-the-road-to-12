/** Display-only legacy class rename. Booking eligibility remains server-owned. */
export function memberClassDisplayTitle(sessionTitle: string | null | undefined, classTypeName?: string | null) {
  if (classTypeName?.trim().toLocaleLowerCase("en-GB") === "girls and gains" && /^women\s+only$/i.test(sessionTitle?.trim() ?? "")) return "Girls and Gains";
  return sessionTitle?.trim() || classTypeName?.trim() || "Club class";
}

/** Presentation helper for current class names over dated session snapshots. */
export function displayClassTitle(sessionTitle: string | undefined, classTypeName: string | undefined) {
  const datedTitle = sessionTitle?.trim();
  const typeName = classTypeName?.trim();
  if (typeName?.toLocaleLowerCase("en-GB") === "girls and gains" && datedTitle?.toLocaleLowerCase("en-GB") === "women only") return typeName;
  return datedTitle || typeName || "Class session";
}

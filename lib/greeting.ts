export function coachGreeting(displayName: string | undefined, timezone: string, date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hour12: false }).format(date));
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const profileDisplayName = displayName?.trim();
  const safeName = profileDisplayName && !/^(ready|train with caution|recovery priority)$/i.test(profileDisplayName) ? profileDisplayName : undefined;
  return `Good ${period}${safeName ? `, ${safeName}` : ""}`;
}

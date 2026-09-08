export const GLOW_ZONE_LEGAL_ENTITY = "MADHOUSE PRODUCTS AND SERVICES LIMITED";
export const GLOW_ZONE_LOCATION = "Madhouse Gym Carlton";
export const glowZoneHours = ["Monday–Friday · 08:00–20:00", "Saturday · 10:00–13:00", "Sunday · Closed", "Times may vary"];
export const glowZonePackages = [
  { id: "member-30", name: "30 Minute Starter", minutes: 30, priceMinor: 1000, membersOnly: true },
  { id: "member-100", name: "100 Minute Power Bundle", minutes: 100, priceMinor: 3000, membersOnly: true },
  { id: "quick-30", name: "Quick Glow", minutes: 30, priceMinor: 1800, membersOnly: false },
  { id: "bronze-60", name: "Bronze Builder", minutes: 60, priceMinor: 3000, membersOnly: false },
  { id: "full-100", name: "Full Tan", minutes: 100, priceMinor: 5000, membersOnly: false },
];
export function glowZoneSafety(){return ["GLOW ZONE is for customers aged 18 and over.","Follow recommended exposure times and allow recovery time between sessions.","Use protective eyewear and do not use a sunbed with sunburnt or damaged skin.","Some medicines increase UV sensitivity; seek appropriate professional advice if you have concerns.","Tanning accelerators and cosmetics do not replace UV protection."];}

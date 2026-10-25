export const GLOW_ZONE_LEGAL_ENTITY = "MADHOUSE PRODUCTS AND SERVICES LIMITED";
export const GLOW_ZONE_LOCATION = "Madhouse Gym Carlton";
export const GLOW_SESSION_MINUTES = { min: 1, max: 15 } as const;
export const GLOW_SESSION_TTL_MINUTES = 5;
export const glowBedTypes = ["stand_up", "lying_down"] as const;
export type GlowBedType = typeof glowBedTypes[number];
export type GlowSessionStatus = "pending" | "cancelled" | "redeemed" | "expired";
export type GlowSessionRequest = {
  id: string;
  bed_type: GlowBedType;
  duration_minutes: number;
  status: GlowSessionStatus;
  expires_at: string;
  created_at: string;
  redeemed_at?: string | null;
  token_suffix: string;
  token?: string;
};
export type GlowReceptionRequest = GlowSessionRequest & {
  user_id: string;
  customer_name: string;
  customer_email?: string | null;
  balance_minutes: number;
  age_status: "verified" | "under_18" | "required";
};
export function isGlowBedType(value: unknown): value is GlowBedType { return glowBedTypes.includes(value as GlowBedType); }
export function isGlowSessionDuration(value: unknown) { return Number.isInteger(value) && Number(value) >= GLOW_SESSION_MINUTES.min && Number(value) <= GLOW_SESSION_MINUTES.max; }
export function glowBedLabel(value: GlowBedType) { return value === "stand_up" ? "Stand-up" : "Lying-down"; }
export const glowZonePackages = [
  { id: "member-30", name: "30 minutes", minutes: 30, priceMinor: 1000, membersOnly: true },
  { id: "member-60", name: "60 minutes", minutes: 60, priceMinor: 1800, membersOnly: true },
  { id: "member-100", name: "100 minutes", minutes: 100, priceMinor: 3000, membersOnly: true },
  { id: "standard-30", name: "30 minutes", minutes: 30, priceMinor: 1500, membersOnly: false },
  { id: "standard-60", name: "60 minutes", minutes: 60, priceMinor: 2500, membersOnly: false },
  { id: "standard-100", name: "100 minutes", minutes: 100, priceMinor: 4000, membersOnly: false },
];
export function glowZoneSafety(){return ["GLOW ZONE is for customers aged 18 and over.","Follow recommended exposure times and allow recovery time between sessions.","Use protective eyewear and do not use a sunbed with sunburnt or damaged skin.","Some medicines increase UV sensitivity; seek appropriate professional advice if you have concerns.","Tanning accelerators and cosmetics do not replace UV protection."];}

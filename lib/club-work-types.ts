export const MEMBER_PT_TYPES = [
  ["solo", "Solo PT"],
  ["package", "PT Package"],
  ["transformation", "1-to-1 Transformation"],
] as const;

export type MemberPtType = (typeof MEMBER_PT_TYPES)[number][0];

export function staffWorkActions() {
  return ["Log shift", "Log PT"] as const;
}

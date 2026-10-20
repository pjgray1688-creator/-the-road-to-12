export type AuthHomeState = "loading" | "signed_in" | "signed_out" | "error";

export function authHomeStateForUser(userId: string | null): AuthHomeState {
  return userId ? "signed_in" : "signed_out";
}

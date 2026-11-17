export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 1024;

export function validateAuthPassword(password: string, confirmation?: string) {
  if (password.length < AUTH_PASSWORD_MIN_LENGTH || password.length > AUTH_PASSWORD_MAX_LENGTH) return "invalid_length" as const;
  if (confirmation !== undefined && password !== confirmation) return "mismatch" as const;
  return null;
}

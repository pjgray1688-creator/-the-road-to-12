type AuthErrorLike = { code?: unknown; status?: unknown; message?: unknown } | null | undefined;

function errorText(error: AuthErrorLike) {
  return [error?.code, error?.message].filter(value => typeof value === "string").join(" ").toLowerCase();
}

export function isUnverifiedEmailError(error: AuthErrorLike) {
  const text = errorText(error);
  return text.includes("email_not_confirmed") || text.includes("email not confirmed") || text.includes("email unverified");
}

export function isInvalidCredentialsError(error: AuthErrorLike) {
  const text = errorText(error);
  return text.includes("invalid_credentials") || text.includes("invalid login credentials") || text.includes("email or password is incorrect");
}

export function isStaleAuthSessionError(error: AuthErrorLike) {
  const text = errorText(error);
  return text.includes("pgrst303") || text.includes("jwt issued at future") || text.includes("invalid jwt") || text.includes("jwt expired") || text.includes("refresh_token_not_found") || text.includes("refresh token not found") || text.includes("session missing");
}

export function signInErrorMessage(error: AuthErrorLike) {
  if (isInvalidCredentialsError(error)) return "That email and password don’t match. Check them and try again.";
  if (isUnverifiedEmailError(error)) return "Your email address still needs verification. Check your inbox for the verification link before signing in.";
  if (isStaleAuthSessionError(error)) return "Your previous sign-in session is no longer valid. We’ve cleared it; please sign in again.";
  return "R12 couldn’t complete sign-in just now. Please try again in a moment.";
}

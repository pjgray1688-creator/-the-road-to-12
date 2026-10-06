export const NOTIFICATION_MAX_ATTEMPTS = 3;

export function retryDelaySeconds(attempt: number) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1));
}

export function shouldRetry(attempt: number, retryable: boolean) {
  return retryable && attempt < NOTIFICATION_MAX_ATTEMPTS;
}

export function workerId() { return `r12-notifications-${process.pid}-${Date.now()}`; }


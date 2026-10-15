export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_WORKER_MAX_BATCH_SIZE = 100;
export const NOTIFICATION_WORKER_MAX_BATCHES = 10;
export const NOTIFICATION_WORKER_RUNTIME_BUDGET_MS = 240_000;
export const NOTIFICATION_WORKER_SEND_CONCURRENCY = 10;
export const NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS = 20_000;

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function notificationWorkerLimits(env: NodeJS.ProcessEnv = process.env) {
  const batchSize = positiveInteger(env.R12_NOTIFICATION_BATCH_SIZE, 100, NOTIFICATION_WORKER_MAX_BATCH_SIZE);
  const maxBatches = positiveInteger(env.R12_NOTIFICATION_MAX_BATCHES_PER_RUN, 10, NOTIFICATION_WORKER_MAX_BATCHES);
  return {
    batchSize,
    maxBatches,
    runtimeBudgetMs: NOTIFICATION_WORKER_RUNTIME_BUDGET_MS,
    sendConcurrency: NOTIFICATION_WORKER_SEND_CONCURRENCY,
    messageTimeoutMs: NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS,
    maxMessagesPerRun: batchSize * maxBatches,
  };
}

export function retryDelaySeconds(attempt: number) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1));
}

export function shouldRetry(attempt: number, retryable: boolean) {
  return retryable && attempt < NOTIFICATION_MAX_ATTEMPTS;
}

export function workerId() { return `r12-notifications-${process.pid}-${Date.now()}`; }


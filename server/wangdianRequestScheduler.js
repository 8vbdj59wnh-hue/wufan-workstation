const rateLimitPattern = /(?:status\s*[=:]?\s*100|接口失败（100）|调用频率|频率限制|too many requests)/iu;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isWangdianRateLimitError(error) {
  return rateLimitPattern.test(String(error?.message ?? error ?? ""));
}

export function createWangdianRequestScheduler(options = {}) {
  const limit = Math.max(1, Number(options.requestsPerMinute ?? 55));
  const intervalMs = Math.max(0, Number(options.minimumIntervalMs ?? Math.ceil(60000 / limit)));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 5));
  const baseDelayMs = Math.max(1, Number(options.baseDelayMs ?? 2000));
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs ?? 60000));
  const sleep = options.sleep ?? wait;
  const clock = options.now ?? (() => Date.now());
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let tail = Promise.resolve();

  async function reserve(onEvent) {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const delayMs = Math.max(0, lastStartedAt + intervalMs - clock());
      if (delayMs > 0) {
        onEvent?.({ type: "throttle_wait", waitMs: delayMs });
        await sleep(delayMs);
      }
      lastStartedAt = clock();
    } finally {
      release();
    }
  }

  return {
    async execute(operation, context = {}) {
      const onEvent = context.onEvent;
      for (let attempt = 0; ; attempt += 1) {
        await reserve(onEvent);
        try {
          onEvent?.({ type: "request_started", attempt });
          const result = await operation();
          onEvent?.({ type: "request_succeeded", attempt });
          return result;
        } catch (error) {
          if (!isWangdianRateLimitError(error) || attempt >= maxRetries) {
            onEvent?.({ type: "request_failed", attempt, retryable: false, message: error?.message ?? String(error) });
            throw error;
          }
          const waitMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
          onEvent?.({ type: "rate_limit_retry", attempt: attempt + 1, waitMs, message: error?.message ?? String(error) });
          await sleep(waitMs);
        }
      }
    },
    config: { requestsPerMinute: limit, minimumIntervalMs: intervalMs, maxRetries, baseDelayMs, maxDelayMs },
  };
}

export const wangdianRequestScheduler = createWangdianRequestScheduler({
  requestsPerMinute: Number(process.env.WDT_REQUESTS_PER_MINUTE || 55),
  maxRetries: Number(process.env.WDT_RATE_LIMIT_MAX_RETRIES || 5),
  baseDelayMs: Number(process.env.WDT_RATE_LIMIT_BASE_DELAY_MS || 2000),
  maxDelayMs: Number(process.env.WDT_RATE_LIMIT_MAX_DELAY_MS || 60000),
});

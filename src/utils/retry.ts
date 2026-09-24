interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  retryableCodes?: number[];
  maxServerDelayMs?: number;
}

function parseDetailsRetryDelay(rawDetails: unknown): number | null {
  if (!Array.isArray(rawDetails)) return null;
  for (const item of rawDetails) {
    if (typeof item?.retryDelay === 'string') {
      const seconds = Number.parseFloat(item.retryDelay.replace(/s$/i, ''));
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }
    }
  }
  return null;
}

function parseJsonRetryDelay(message: string): number | null {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(message.slice(start, end + 1));
    return parseDetailsRetryDelay(parsed?.error?.details ?? parsed?.details);
  } catch {
    return null;
  }
}

function parseRegexRetryDelay(message: string): number | null {
  const match =
    message.match(/retry\s+in\s+([\d.]+)\s*s/i) ??
    message.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s?/i);
  if (!match?.[1]) return null;
  const seconds = Number.parseFloat(match[1]);
  return !Number.isNaN(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

function parseMessageRetryDelay(message: string): number | null {
  if (!message) return null;
  return parseJsonRetryDelay(message) ?? parseRegexRetryDelay(message);
}

function parseHeaderRetryDelay(headers: unknown): number | null {
  if (!headers) return null;
  const headerVal =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, string>)['retry-after'];

  if (headerVal) {
    const seconds = Number.parseFloat(headerVal);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }
  return null;
}

export function extractRetryDelayMs(error: unknown): number | null {
  if (!error) return null;
  const err = error as Record<string, unknown>;

  const directDelay = parseDetailsRetryDelay(
    err.details ?? (err.error as Record<string, unknown> | undefined)?.details,
  );
  if (directDelay !== null) return directDelay;

  const msgDelay = parseMessageRetryDelay(typeof err.message === 'string' ? err.message : '');
  if (msgDelay !== null) return msgDelay;

  const headers = err.headers ?? (err.response as Record<string, unknown> | undefined)?.headers;
  return parseHeaderRetryDelay(headers);
}

function isRetryableError(status: number, message: string, retryableCodes: number[]): boolean {
  if (retryableCodes.includes(status)) return true;
  return /resource_exhausted|quota|too many requests|rate limit|high demand|unavailable|capacity/i.test(
    message,
  );
}

function calculateWaitDelay(
  error: unknown,
  fallbackDelay: number,
  maxServerDelayMs: number,
): number {
  const serverDelayMs = extractRetryDelayMs(error);
  if (serverDelayMs === null) {
    return fallbackDelay + Math.random() * 500;
  }

  const targetWait = serverDelayMs + 1000;
  if (targetWait > maxServerDelayMs) {
    throw error;
  }
  return targetWait;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const retryableCodes = options.retryableCodes ?? [429, 500, 502, 503, 504];
  const maxServerDelayMs = options.maxServerDelayMs ?? 65_000;

  let attempt = 0;
  let delay = options.initialDelayMs ?? 1500;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt++;
      const err = error as { status?: number; code?: number; message?: string };
      const status = Number(err.status ?? err.code);
      const message = err.message ?? '';

      if (attempt > maxRetries || !isRetryableError(status, message, retryableCodes)) {
        throw error;
      }

      const waitTime = calculateWaitDelay(error, delay, maxServerDelayMs);
      console.warn(
        `Gemini API retryable error (${status || 'transient'}). Retrying ${attempt}/${maxRetries} in ${Math.round(waitTime)}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      delay *= backoffMultiplier;
    }
  }

  throw new Error('Retry attempts exhausted');
}

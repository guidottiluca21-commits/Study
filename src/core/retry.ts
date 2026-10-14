/** Retry con backoff esponenziale e jitter, per errori temporanei di rete o dei provider. */
export interface RetryOptions {
  attempts?: number; // tentativi totali (default 4)
  baseMs?: number; // attesa iniziale (default 1000)
  maxMs?: number; // attesa massima (default 30000)
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
  random?: () => number; // iniettabile per i test
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Errore che il chiamante classifica esplicitamente come temporaneo o definitivo. */
export class HttpError extends Error {
  constructor(message: string, public status: number, public retryAfterMs?: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isTransient(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500 || err.status === 408;
  const code = (err as { code?: string } | null)?.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ESOCKET', 'ECONNECTION'].includes(code)) return true;
  const msg = String((err as Error | null)?.message ?? '');
  return /fetch failed|network|timeout|timed out|socket hang up|temporar|try again|rate limit/i.test(msg);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 30_000;
  const retryable = opts.isRetryable ?? isTransient;
  const sleep = opts.sleep ?? defaultSleep;
  const rnd = opts.random ?? Math.random;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !retryable(err)) throw err;
      let wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      wait = Math.round(wait / 2 + rnd() * (wait / 2)); // jitter: 50%..100%
      if (err instanceof HttpError && err.retryAfterMs) wait = Math.max(wait, Math.min(err.retryAfterMs, maxMs));
      opts.onRetry?.(err, attempt, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

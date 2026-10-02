import { AppError } from './errors';

/** Combine several signals into one that aborts when any of them aborts. */
export function anySignal(signals: Array<AbortSignal | undefined | null>): AbortSignal {
  const list = signals.filter(Boolean) as AbortSignal[];
  if (list.length === 0) return new AbortController().signal;
  if (list.length === 1) return list[0];
  return AbortSignal.any(list);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export interface FetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

/**
 * fetch() with a hard timeout that is also cancellable from the outside.
 * Throws AppError('TIMEOUT' | 'NETWORK') so callers can show friendly copy.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 20_000, signal, headers, method = 'GET', body } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const combined = anySignal([signal, controller.signal]);
  try {
    return await fetch(url, {
      method,
      body,
      headers,
      signal: combined,
      cache: 'no-store',
      redirect: 'follow',
    });
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AppError('TIMEOUT', `No response from ${safeHost(url)} within ${Math.round(timeoutMs / 1000)}s.`, {
        status: 504,
        retryable: true,
      });
    }
    throw new AppError('NETWORK', `Could not reach ${safeHost(url)}.`, {
      status: 502,
      retryable: true,
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the server';
  }
}

export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError('PROVIDER_ERROR', 'The provider returned a malformed response.', {
      status: 502,
      detail: text.slice(0, 400),
    });
  }
}

export interface RetryOptions {
  attempts?: number; // total attempts (default 2 = one retry)
  delayMs?: number;
  signal?: AbortSignal;
  /** Return false to stop retrying (e.g. invalid key errors). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

/**
 * Run `fn`, retrying once by default on retryable failures.
 * Aborts immediately if the caller's signal fires.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 2, delayMs = 700, signal, shouldRetry, onRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (signal?.aborted) throw err;
      const canRetry =
        attempt < attempts &&
        (shouldRetry ? shouldRetry(err, attempt) : !(err instanceof AppError) || err.retryable);
      if (!canRetry) throw err;
      onRetry?.(err, attempt);
      await sleep(delayMs * attempt, signal);
    }
  }
  throw lastErr;
}

export function truncate(text: string, max: number, note = '…[truncated]'): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max) + note, truncated: true };
}

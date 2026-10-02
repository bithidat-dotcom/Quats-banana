import { AppError } from '@/lib/errors';
import { withRetry } from '@/lib/http';
import { fetchPage, titleFromUrl, type FetchedPage, type FetchPageOptions } from './fetch';

export { fetchPage, titleFromUrl };
export type { FetchedPage, FetchPageOptions };
export { assertPublicUrl, isBlockedHostname, isPrivateIp } from './ssrf';

/** One retry, then give up — the agent skips that URL and reports the gap. */
export async function fetchPageWithRetry(
  url: string,
  opts: FetchPageOptions = {},
): Promise<{ page: FetchedPage; retried: boolean }> {
  let retried = false;
  const page = await withRetry(() => fetchPage(url, opts), {
    attempts: 2,
    delayMs: 800,
    signal: opts.signal,
    // Never retry pages that are blocked, missing, too big or unsupported.
    shouldRetry: (err) =>
      err instanceof AppError ? err.retryable : true,
    onRetry: () => {
      retried = true;
    },
  });
  return { page, retried };
}

/** Cheap dedupe/quality filter used before deciding what to read. */
export function isReadableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const path = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3|zip|gz|rar|exe|dmg|css|js|ico|woff2?)$/.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

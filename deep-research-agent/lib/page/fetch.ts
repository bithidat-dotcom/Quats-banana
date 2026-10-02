import { DEMO_NOTICE, demoSampleByUrl } from '@/lib/demo/sources';
import { AppError } from '@/lib/errors';
import { fetchWithTimeout } from '@/lib/http';
import { assertPublicUrl } from './ssrf';
import { extractFromHtml, extractFromPdf, looksLikePdf, normalizeWhitespace } from './extract';

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  publishedDate?: string;
  contentType: string;
  chars: number;
  truncated: boolean;
  via: 'html' | 'pdf' | 'text' | 'json';
  ms: number;
}

export interface FetchPageOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Max characters of text kept (the caller truncates further if needed). */
  maxChars?: number;
  maxBytes?: number;
  /** Hosts we have already read this session (avoids duplicate downloads). */
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 200_000;
const MAX_REDIRECTS = 5;

const BLOCKED_HINTS =
  /(just a moment|enable javascript and cookies|cf-browser-verification|attention required|access denied|are you a robot|verify you are human|please enable javascript|403 forbidden|you have been blocked)/i;

/** Read a response body with a byte cap so a huge page cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<{ buf: Uint8Array; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes * 4) {
    throw new AppError('PAGE_TOO_LARGE', `The file is ${Math.round(declared / 1_048_576)} MB, over the limit.`, {
      status: 413,
    });
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { buf: buf.slice(0, maxBytes), truncated: buf.byteLength > maxBytes };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const remaining = maxBytes - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, Math.max(0, remaining)));
        total = maxBytes;
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { buf, truncated };
}

function assertNotBlocked(res: Response, url: string, bodyStart: string) {
  if (res.status === 401 || res.status === 403) {
    throw new AppError('PAGE_BLOCKED', `${hostOf(url)} refused the request (${res.status}).`, { status: 422 });
  }
  if (res.status === 429) {
    throw new AppError('RATE_LIMIT', `${hostOf(url)} is rate-limiting automated readers.`, {
      status: 429,
      retryable: true,
    });
  }
  if (res.status === 404) {
    throw new AppError('NOT_FOUND', `${hostOf(url)} returned 404.`, { status: 404 });
  }
  if (res.status === 402 || res.status === 451) {
    throw new AppError('PAGE_BLOCKED', `${hostOf(url)} returned ${res.status} (paywall or legally restricted).`, {
      status: 422,
    });
  }
  if (res.status >= 500) {
    throw new AppError('NETWORK', `${hostOf(url)} returned a server error (${res.status}).`, {
      status: 502,
      retryable: true,
    });
  }
  if (BLOCKED_HINTS.test(bodyStart) && bodyStart.length < 6000) {
    throw new AppError('PAGE_BLOCKED', `${hostOf(url)} served a bot-check or JavaScript wall instead of content.`, {
      status: 422,
    });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Download a page (HTML, plain text or PDF) and return clean readable text.
 * Redirects are validated individually to keep SSRF protection intact.
 */
export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const started = Date.now();
  const maxBytes = opts.maxBytes ?? Number(process.env.DR_MAX_PAGE_BYTES ?? DEFAULT_MAX_BYTES);
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const allowLocalhost = process.env.DR_ALLOW_LOCALHOST === '1';

  // Offline demo mode: URLs on the bundled sample host resolve to the local
  // document instead of hitting the network (and never touch SSRF checks,
  // because nothing is requested).
  const demo = demoSampleByUrl(rawUrl);
  if (demo && process.env.DR_ENABLE_DEMO !== '0') {
    // The notice sits at the end so it never pollutes the opening sentences
    // that the writing model leans on.
    const text = clip(normalizeWhitespace(`${demo.text}\n\n[${DEMO_NOTICE}]`), maxChars);
    return {
      url: rawUrl,
      finalUrl: rawUrl,
      title: demo.title,
      text: text.value,
      publishedDate: demo.publishedDate,
      contentType: 'text/plain; charset=utf-8',
      chars: text.value.length,
      truncated: text.cut,
      via: 'text',
      ms: Date.now() - started,
    };
  }

  let current = await assertPublicUrl(rawUrl, { allowLocalhost });
  let res: Response | undefined;

  for (let hop = 0; hop <= (opts.maxRedirects ?? MAX_REDIRECTS); hop++) {
    res = await fetchWithTimeout(current.toString(), {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: opts.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; DeepResearchAgent/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.9',
      },
      method: 'GET',
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) break;
      const next = new URL(location, current);
      current = await assertPublicUrl(next.toString(), { allowLocalhost });
      continue;
    }
    break;
  }

  if (!res) throw new AppError('NETWORK', `Could not load ${hostOf(rawUrl)}.`, { status: 502, retryable: true });

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const { buf, truncated } = await readCapped(res, maxBytes);
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4096));

  assertNotBlocked(res, current.toString(), head);

  // ------------------------------------------------------------------ PDF
  if (looksLikePdf(buf, contentType)) {
    const article = await extractFromPdf(buf);
    const text = clip(article.text, maxChars);
    return {
      url: rawUrl,
      finalUrl: current.toString(),
      title: article.title ?? titleFromUrl(current.toString()),
      text: text.value,
      publishedDate: article.publishedDate,
      contentType: contentType || 'application/pdf',
      chars: text.value.length,
      truncated: truncated || text.cut,
      via: 'pdf',
      ms: Date.now() - started,
    };
  }

  // ------------------------------------------------------- plain text / JSON
  if (
    contentType.includes('text/plain') ||
    contentType.includes('text/markdown') ||
    contentType.includes('application/json') ||
    contentType.includes('text/csv')
  ) {
    const decoded = normalizeWhitespace(new TextDecoder('utf-8', { fatal: false }).decode(buf));
    const text = clip(decoded, maxChars);
    return {
      url: rawUrl,
      finalUrl: current.toString(),
      title: titleFromUrl(current.toString()),
      text: text.value,
      contentType,
      chars: text.value.length,
      truncated: truncated || text.cut,
      via: contentType.includes('json') ? 'json' : 'text',
      ms: Date.now() - started,
    };
  }

  // ------------------------------------------------------------------ HTML
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const article = await extractFromHtml(html, current.toString());
  const text = clip(article.text, maxChars);
  return {
    url: rawUrl,
    finalUrl: current.toString(),
    title: article.title?.trim() || titleFromUrl(current.toString()),
    text: text.value,
    publishedDate: article.publishedDate,
    contentType: contentType || 'text/html',
    chars: text.value.length,
    truncated: truncated || text.cut,
    via: 'html',
    ms: Date.now() - started,
  };
}

function clip(text: string, max: number): { value: string; cut: boolean } {
  if (text.length <= max) return { value: text, cut: false };
  return { value: `${text.slice(0, max)}\n\n…[content truncated for length]`, cut: true };
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    const cleaned = decodeURIComponent(last)
      .replace(/\.(html?|php|aspx?|pdf|md|txt)$/i, '')
      .replace(/[-_+]+/g, ' ')
      .trim();
    return cleaned.length > 3 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : u.hostname;
  } catch {
    return url;
  }
}

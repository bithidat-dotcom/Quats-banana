import { AppError, mapHttpStatus } from '@/lib/errors';
import { demoSamplesForQuestion } from '@/lib/demo/sources';
import { fetchWithTimeout, readJson, withRetry } from '@/lib/http';
import type { SearchResult } from '@/lib/types';

export interface SearchArgs {
  query: string;
  maxResults?: number;
  /** Restrict to the last N days where the provider supports it. */
  recencyDays?: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  id: string;
  label: string;
  search(args: SearchArgs): Promise<SearchResult[]>;
}

const clamp = (n: number | undefined, min: number, max: number, fallback: number) => {
  const v = Number.isFinite(n) ? Number(n) : fallback;
  return Math.min(max, Math.max(min, v));
};

/* ------------------------------------------------------------------ Tavily */

interface TavilyResponse {
  results?: {
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
    score?: number;
  }[];
}

export class TavilyProvider implements SearchProvider {
  id = 'tavily';
  label = 'Tavily';
  constructor(private apiKey: string) {}

  async search({ query, maxResults, signal }: SearchArgs): Promise<SearchResult[]> {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      timeoutMs: 20_000,
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        max_results: clamp(maxResults, 1, 10, 5),
        include_answer: false,
        include_raw_content: false,
        topic: 'general',
      }),
    });
    if (!res.ok) throw mapHttpStatus(res.status, await res.text().catch(() => ''));
    const json = await readJson<TavilyResponse>(res);
    return (json.results ?? [])
      .filter((r) => r.url)
      .map((r, i) => ({
        title: clean(r.title) || hostOf(r.url!),
        url: r.url!,
        snippet: clean(r.content).slice(0, 500),
        publishedDate: r.published_date ? normalizeDate(r.published_date) : undefined,
        provider: this.id,
        rank: i + 1,
      }));
  }
}

/* ------------------------------------------------------------------- Brave */

interface BraveResponse {
  web?: {
    results?: {
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      page_age?: string;
    }[];
  };
}

export class BraveProvider implements SearchProvider {
  id = 'brave';
  label = 'Brave Search';
  constructor(private apiKey: string) {}

  async search({ query, maxResults, recencyDays, signal }: SearchArgs): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(clamp(maxResults, 1, 20, 5)),
      safesearch: 'moderate',
      text_decorations: 'false',
    });
    if (recencyDays && recencyDays > 0) {
      const days = Math.min(365, recencyDays);
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      params.set('freshness', `${from}to${to}`);
    }
    const res = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      timeoutMs: 20_000,
      signal,
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip',
        'x-subscription-token': this.apiKey,
      },
    });
    if (!res.ok) throw mapHttpStatus(res.status, await res.text().catch(() => ''));
    const json = await readJson<BraveResponse>(res);
    return (json.web?.results ?? [])
      .filter((r) => r.url)
      .map((r, i) => ({
        title: clean(r.title) || hostOf(r.url!),
        url: r.url!,
        snippet: clean(r.description).slice(0, 500),
        publishedDate: normalizeDate(r.page_age ?? r.age),
        provider: this.id,
        rank: i + 1,
      }));
  }
}

/* ------------------------------------------------------------------ Serper */

interface SerperResponse {
  organic?: { title?: string; link?: string; snippet?: string; date?: string }[];
  knowledgeGraph?: { description?: string; descriptionLink?: string };
}

export class SerperProvider implements SearchProvider {
  id = 'serper';
  label = 'Serper (Google)';
  constructor(private apiKey: string) {}

  async search({ query, maxResults, signal }: SearchArgs): Promise<SearchResult[]> {
    const res = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      timeoutMs: 20_000,
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({ q: query, num: clamp(maxResults, 1, 10, 5) }),
    });
    if (!res.ok) throw mapHttpStatus(res.status, await res.text().catch(() => ''));
    const json = await readJson<SerperResponse>(res);
    const results = (json.organic ?? [])
      .filter((r) => r.link)
      .map((r, i) => ({
        title: clean(r.title) || hostOf(r.link!),
        url: r.link!,
        snippet: clean(r.snippet).slice(0, 500),
        publishedDate: normalizeDate(r.date),
        provider: this.id,
        rank: i + 1,
      }));
    return results;
  }
}

/* ------------------------------------------------------------------ Demo */

export class DemoSearchProvider implements SearchProvider {
  id = 'demo';
  label = 'Demo (offline sample sources)';

  async search({ query, maxResults, signal }: SearchArgs): Promise<SearchResult[]> {
    await new Promise((r) => setTimeout(r, 150));
    if (signal?.aborted) throw new AppError('TIMEOUT', 'Search cancelled.', { status: 499 });
    return demoSamplesForQuestion(query, clamp(maxResults, 1, 6, 5)).map((s, i) => ({
      title: s.title,
      url: s.url,
      snippet: s.text.split('\n').slice(2, 5).join(' ').slice(0, 400),
      publishedDate: s.publishedDate,
      provider: this.id,
      rank: i + 1,
    }));
  }
}

/* ----------------------------------------------------------------- utils */

function clean(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Best-effort normalisation of the many date shapes search APIs return. */
export function normalizeDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const raw = String(input).trim();
  if (!raw) return undefined;

  // ISO timestamp
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "2 days ago", "3 weeks ago", "5 hours ago"
  const rel = /(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i.exec(raw);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_629_800_000,
      year: 31_557_600_000,
    };
    return new Date(Date.now() - n * (ms[unit] ?? 0)).toISOString().slice(0, 10);
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return undefined;
}

/** One retry per search, then give up (the agent then skips that query). */
export async function searchWithRetry(
  provider: SearchProvider,
  args: SearchArgs,
): Promise<{ results: SearchResult[]; retried: boolean }> {
  let retried = false;
  const results = await withRetry(() => provider.search(args), {
    attempts: 2,
    delayMs: 600,
    signal: args.signal,
    onRetry: () => {
      retried = true;
    },
  });
  return { results, retried };
}

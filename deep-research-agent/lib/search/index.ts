import { AppError } from '@/lib/errors';
import type { SearchProviderOption, SearchResult } from '@/lib/types';
import {
  BraveProvider,
  DemoSearchProvider,
  SerperProvider,
  TavilyProvider,
  searchWithRetry,
  type SearchArgs,
  type SearchProvider,
} from './providers';

export { searchWithRetry, normalizeDate } from './providers';
export type { SearchArgs, SearchProvider } from './providers';

export const SEARCH_PROVIDER_OPTIONS: SearchProviderOption[] = [
  { id: 'tavily', label: 'Tavily', envKeys: ['TAVILY_API_KEY'], signupUrl: 'https://app.tavily.com/home' },
  {
    id: 'brave',
    label: 'Brave Search API',
    envKeys: ['BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY'],
    signupUrl: 'https://api-dashboard.search.brave.com/',
  },
  { id: 'serper', label: 'Serper (Google)', envKeys: ['SERPER_API_KEY'], signupUrl: 'https://serper.dev/' },
  { id: 'demo', label: 'Demo (offline sample sources)', envKeys: [], signupUrl: '' },
];

function envKeyFor(id: string): string | undefined {
  const opt = SEARCH_PROVIDER_OPTIONS.find((p) => p.id === id);
  for (const k of opt?.envKeys ?? []) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

export function isDemoSearchEnabled(): boolean {
  return process.env.DR_ENABLE_DEMO !== '0';
}

export function searchProviderAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of SEARCH_PROVIDER_OPTIONS) {
    out[p.id] = p.id === 'demo' ? isDemoSearchEnabled() : !!envKeyFor(p.id);
  }
  return out;
}

/** Build one provider, preferring a key supplied by the caller at request time. */
export function buildSearchProvider(id: string, apiKey?: string): SearchProvider {
  const key = apiKey?.trim() || envKeyFor(id);
  switch (id) {
    case 'tavily':
      if (!key) throw new AppError('MISSING_KEY', 'No Tavily API key available.', { status: 400 });
      return new TavilyProvider(key);
    case 'brave':
      if (!key) throw new AppError('MISSING_KEY', 'No Brave Search API key available.', { status: 400 });
      return new BraveProvider(key);
    case 'serper':
      if (!key) throw new AppError('MISSING_KEY', 'No Serper API key available.', { status: 400 });
      return new SerperProvider(key);
    case 'demo':
      if (!isDemoSearchEnabled()) {
        throw new AppError('MISSING_KEY', 'Demo search is disabled on this server.', { status: 400 });
      }
      return new DemoSearchProvider();
    default:
      throw new AppError('BAD_REQUEST', `Unknown search provider "${id}".`, { status: 400 });
  }
}

export function defaultSearchProvider(): string {
  for (const id of ['tavily', 'brave', 'serper']) {
    if (envKeyFor(id)) return id;
  }
  return isDemoSearchEnabled() ? 'demo' : 'tavily';
}

export interface SearchRouterOptions {
  /** Preferred provider id, or 'auto' to use whatever is configured. */
  preferred?: string;
  /** Optional per-request key override (from Settings). */
  apiKey?: string;
  signal?: AbortSignal;
  maxResults?: number;
}

export interface RoutedSearchResult {
  provider: string;
  results: SearchResult[];
  retried: boolean;
  /** Errors from providers that were skipped, for the progress log. */
  skipped: { provider: string; message: string }[];
}

/**
 * Run a search, falling back to other configured providers when one is
 * rate-limited or its key is rejected. Retries each provider once.
 */
export async function runSearch(query: string, opts: SearchRouterOptions = {}): Promise<RoutedSearchResult> {
  const preferred = opts.preferred && opts.preferred !== 'auto' ? opts.preferred : defaultSearchProvider();
  const order = [preferred, ...SEARCH_PROVIDER_OPTIONS.map((p) => p.id).filter((id) => id !== preferred)];

  const available = order.filter((id) => (id === preferred ? true : searchProviderAvailability()[id]));
  const skipped: { provider: string; message: string }[] = [];
  let lastError: unknown;

  for (const id of available) {
    let provider: SearchProvider;
    try {
      provider = buildSearchProvider(id, id === preferred ? opts.apiKey : undefined);
    } catch (err) {
      skipped.push({ provider: id, message: err instanceof Error ? err.message : 'unavailable' });
      continue;
    }
    try {
      const { results, retried } = await searchWithRetry(provider, {
        query,
        maxResults: opts.maxResults,
        signal: opts.signal,
      });
      if (!results.length) {
        lastError = new AppError('NO_RESULTS', `No results for "${query}".`, { status: 200 });
        skipped.push({ provider: id, message: 'no results' });
        continue;
      }
      return { provider: id, results, retried, skipped };
    } catch (err) {
      lastError = err;
      skipped.push({ provider: id, message: err instanceof Error ? err.message : 'failed' });
      // A fatal problem with the preferred provider (bad key) should not be
      // masked by silently using another one: only continue on transient errors.
      if (err instanceof AppError && (err.code === 'INVALID_KEY' || err.code === 'MISSING_KEY')) {
        if (id === preferred) continue;
      }
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError('NO_RESULTS', `No search provider returned results for "${query}".`, {
    status: 200,
    detail: skipped.map((s) => `${s.provider}: ${s.message}`).join('; '),
  });
}

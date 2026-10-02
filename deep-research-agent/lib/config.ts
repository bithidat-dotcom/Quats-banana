import { defaultProvider, defaultModelFor, providerAvailability, PROVIDER_CATALOG, isDemoEnabled } from '@/lib/llm';
import { SEARCH_PROVIDER_OPTIONS, defaultSearchProvider, searchProviderAvailability } from '@/lib/search';
import { defaultDepth } from '@/lib/agent/depth';
import { rateLimitConfigFromEnv, getClientIp } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import type { Depth } from '@/lib/types';

/** Everything the browser may know about server configuration (no secrets). */
export interface PublicConfig {
  llm: {
    defaultProvider: string;
    defaultModel: string;
    catalog: typeof PROVIDER_CATALOG;
    available: Record<string, boolean>;
    /** true when at least one provider works without the user typing a key */
    serverKeyConfigured: boolean;
  };
  search: {
    defaultProvider: string;
    options: typeof SEARCH_PROVIDER_OPTIONS;
    available: Record<string, boolean>;
    serverKeyConfigured: boolean;
  };
  defaults: { depth: Depth };
  demoEnabled: boolean;
  limits: { rateLimitMax: number; windowSec: number; maxConcurrent: number };
}

export function getPublicConfig(): PublicConfig {
  const llmAvailable = providerAvailability();
  const searchAvailable = searchProviderAvailability();
  const rl = rateLimitConfigFromEnv();
  return {
    llm: {
      defaultProvider: defaultProvider(),
      defaultModel: defaultModelFor(defaultProvider()),
      catalog: PROVIDER_CATALOG,
      available: llmAvailable,
      serverKeyConfigured: Object.entries(llmAvailable).some(([id, ok]) => ok && id !== 'demo'),
    },
    search: {
      defaultProvider: defaultSearchProvider(),
      options: SEARCH_PROVIDER_OPTIONS,
      available: searchAvailable,
      serverKeyConfigured: Object.entries(searchAvailable).some(([id, ok]) => ok && id !== 'demo'),
    },
    defaults: { depth: defaultDepth() },
    demoEnabled: isDemoEnabled(),
    limits: {
      rateLimitMax: rl.max,
      windowSec: Math.round(rl.windowMs / 1000),
      maxConcurrent: rl.maxConcurrent,
    },
  };
}

export interface RequestCredentials {
  llm: { provider?: string; model?: string; apiKey?: string; baseUrl?: string };
  search: { provider?: string; apiKey?: string };
}

/**
 * API keys can arrive in two ways:
 *  - .env.local on the server (preferred; nothing sensitive in the browser)
 *  - request headers from the Settings tab, for users who don't want to edit
 *    files. Either way the key only ever lives in the server process.
 */
export function credentialsFromRequest(req: Request, body?: Record<string, unknown>): RequestCredentials {
  const h = req.headers;
  const pick = (header: string, fallback?: unknown, max = 400): string | undefined => {
    const value = h.get(header) ?? (typeof fallback === 'string' ? fallback : undefined);
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, max);
  };

  return {
    llm: {
      provider: pick('x-dr-llm-provider', body?.provider, 60),
      model: pick('x-dr-llm-model', body?.model, 120),
      apiKey: pick('x-dr-llm-key', body?.llmKey),
      baseUrl: pick('x-dr-llm-base-url', body?.llmBaseUrl, 300),
    },
    search: {
      provider: pick('x-dr-search-provider', body?.searchProvider ?? body?.search, 60),
      apiKey: pick('x-dr-search-key', body?.searchKey),
    },
  };
}

export function assertBodySize(req: Request, maxBytes = 1_500_000): void {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len && len > maxBytes) {
    throw new AppError('BAD_REQUEST', 'That request was too large.', { status: 413 });
  }
}

export function clientKey(req: Request): string {
  // A user-supplied LLM key means one person can hammer their own quota, so we
  // still rate-limit per IP but with the configured budget.
  return `ip:${getClientIp(req)}`;
}

export { rateLimitConfigFromEnv };

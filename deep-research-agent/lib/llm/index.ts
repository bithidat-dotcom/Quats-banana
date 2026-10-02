import type { LlmProviderOption } from '@/lib/types';
import { AppError } from '@/lib/errors';
import { AnthropicClient } from './anthropic';
import { GeminiClient } from './gemini';
import { MockLLM } from './mock';
import { OpenAIClient } from './openai';
import type { LLMClient } from './types';

export const PROVIDER_CATALOG: LlmProviderOption[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    envKeys: ['ANTHROPIC_API_KEY'],
    defaultModel: 'claude-sonnet-4-5',
    suggestedModels: [
      'claude-sonnet-4-5',
      'claude-opus-4-1',
      'claude-haiku-4-5',
      'claude-3-7-sonnet-latest',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envKeys: ['OPENROUTER_API_KEY'],
    defaultModel: 'openai/gpt-4o-mini',
    suggestedModels: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    envKeys: ['DR_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: '',
    suggestedModels: [],
    needsBaseUrl: true,
  },
  {
    id: 'demo',
    label: 'Demo (no API key, bundled sample sources)',
    envKeys: [],
    defaultModel: 'demo-scripted',
    suggestedModels: ['demo-scripted'],
  },
];

export function isDemoEnabled(): boolean {
  return process.env.DR_ENABLE_DEMO !== '0';
}

export function providerById(id: string): LlmProviderOption | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

export function defaultProvider(): string {
  const configured = process.env.DR_DEFAULT_PROVIDER?.trim();
  if (configured && providerById(configured)) return configured;
  for (const p of PROVIDER_CATALOG) {
    if (p.id === 'demo' || p.id === 'openai-compatible') continue;
    if (p.envKeys.some((k) => !!process.env[k])) return p.id;
  }
  return isDemoEnabled() ? 'demo' : 'gemini';
}

export function defaultModelFor(providerId: string): string {
  if (providerId === defaultProvider() && providerId !== 'demo') {
    const configured = process.env.DR_DEFAULT_MODEL?.trim();
    if (configured) return configured;
  }
  return providerById(providerId)?.defaultModel ?? 'gemini-2.5-flash';
}

/** Which providers can be used right now (env key present, or demo enabled). */
export function providerAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of PROVIDER_CATALOG) {
    if (p.id === 'demo') out[p.id] = isDemoEnabled();
    else if (p.id === 'openai-compatible')
      out[p.id] = !!process.env.DR_OPENAI_BASE_URL && !!(process.env.DR_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    else out[p.id] = p.envKeys.some((k) => !!process.env[k]);
  }
  return out;
}

function envKeyFor(provider: string): string | undefined {
  const p = providerById(provider);
  for (const k of p?.envKeys ?? []) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

const OPENAI_BASES: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export interface ResolveOptions {
  provider?: string;
  model?: string;
  /** Key supplied by the user at request time (never persisted server-side). */
  apiKey?: string;
  baseUrl?: string;
}

/** Build the concrete LLM client for a run. */
export function resolveLLM(opts: ResolveOptions): LLMClient {
  const provider = opts.provider && providerById(opts.provider) ? opts.provider : defaultProvider();
  const model = (opts.model?.trim() || defaultModelFor(provider)).trim();

  if (provider === 'demo') {
    if (!isDemoEnabled()) {
      throw new AppError('MISSING_KEY', 'Demo mode is disabled on this server.', { status: 400 });
    }
    return new MockLLM({ question: '', surface: 'research', depth: 'standard' });
  }

  const apiKey = opts.apiKey?.trim() || envKeyFor(provider);
  if (!apiKey) {
    throw new AppError(
      'MISSING_KEY',
      `No API key available for ${providerById(provider)?.label ?? provider}.`,
      { status: 400 },
    );
  }

  switch (provider) {
    case 'gemini':
      return new GeminiClient({ apiKey, model });
    case 'anthropic':
      return new AnthropicClient({ apiKey, model });
    case 'openai':
      return new OpenAIClient({
        apiKey,
        model,
        baseUrl: opts.baseUrl?.trim() || process.env.DR_OPENAI_BASE_URL || OPENAI_BASES.openai,
        provider: 'openai',
        label: `OpenAI · ${model}`,
      });
    case 'openrouter':
      return new OpenAIClient({
        apiKey,
        model,
        baseUrl: OPENAI_BASES.openrouter,
        provider: 'openrouter',
        label: `OpenRouter · ${model}`,
      });
    case 'openai-compatible': {
      const base = opts.baseUrl?.trim() || process.env.DR_OPENAI_BASE_URL;
      if (!base) {
        throw new AppError('BAD_REQUEST', 'This provider needs a base URL ending in /v1.', { status: 400 });
      }
      return new OpenAIClient({
        apiKey,
        model: model || 'default',
        baseUrl: base,
        provider: 'openai-compatible',
        label: `Custom endpoint · ${model || 'default'}`,
      });
    }
    default:
      throw new AppError('BAD_REQUEST', `Unknown LLM provider "${provider}".`, { status: 400 });
  }
}

/**
 * Mock surfaces need constructor args, so expose a helper the agent uses.
 */
export function resolveMockLLM(args: {
  question: string;
  surface: 'planner' | 'research' | 'writer';
  depth: import('@/lib/types').Depth;
}): MockLLM {
  return new MockLLM(args);
}

export function isMock(client: LLMClient): client is MockLLM {
  return client.provider === 'demo';
}

/** One-token ping used by Settings → "Test key". */
export async function testLlmKey(opts: ResolveOptions): Promise<{ ok: boolean; label: string; message: string }> {
  const client = resolveLLM(opts);
  if (client.provider === 'demo') {
    return { ok: true, label: client.label, message: 'Demo mode is available (no API key needed).' };
  }
  const started = Date.now();
  const res = await client.chat({
    system: 'You are a connectivity test. Reply with the single word: OK',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    allowTools: false,
    maxTokens: 16,
    temperature: 0,
  });
  const text = res.text.trim().slice(0, 40);
  return {
    ok: true,
    label: client.label,
    message: `Connected in ${Date.now() - started} ms. Model replied: "${text || '(empty)'}"`,
  };
}

export { MockLLM };

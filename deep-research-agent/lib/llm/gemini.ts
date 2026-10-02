import { AppError, mapHttpStatus } from '@/lib/errors';
import { fetchWithTimeout, withRetry } from '@/lib/http';
import { iterateSse, sseData, tryJson } from './sse';
import type { ChatMessage, ChatOptions, ChatResult, LLMClient, ToolCall, ToolDefinition } from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* ------------------------------------------------------------------ schema */

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'additionalProperties',
  'format',
  'default',
  'examples',
  'title',
]);

/** Gemini wants an OpenAPI-3 subset with UPPERCASE type names. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
      if (k === 'type' && typeof v === 'string') {
        out.type = v.toUpperCase();
        continue;
      }
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

/* ------------------------------------------------------------- conversions */

type GeminiPart = {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

function toContents(messages: ChatMessage[]) {
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  let pendingToolParts: GeminiPart[] = [];

  const flush = () => {
    if (pendingToolParts.length) {
      contents.push({ role: 'user', parts: pendingToolParts });
      pendingToolParts = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'system') continue; // handled by systemInstruction
    if (m.role === 'tool') {
      // Gemini's REST API wants a JSON object as the functionResponse payload.
      pendingToolParts.push({
        functionResponse: {
          name: m.name,
          response: coerceResponsePayload(m.content),
        },
      });
      continue;
    }
    flush();
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
      continue;
    }
    const parts: GeminiPart[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const call of m.toolCalls ?? []) {
      parts.push({ functionCall: { name: call.name, args: call.args ?? {} } });
    }
    contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '(no output)' }] });
  }
  flush();
  return contents;
}

function coerceResponsePayload(content: string): Record<string, unknown> {
  const parsed = tryJson<Record<string, unknown>>(content);
  if (parsed && typeof parsed === 'object') return parsed;
  return { result: content };
}

/* -------------------------------------------------------------- the client */

export class GeminiClient implements LLMClient {
  provider = 'gemini';
  label: string;
  private apiKey: string;
  private baseUrl: string;
  model: string;

  constructor(opts: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.label = `Google Gemini · ${opts.model}`;
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const useTools = opts.allowTools !== false && !!opts.tools?.length;
    const body: Record<string, unknown> = {
      contents: toContents(opts.messages),
      generationConfig: {
        temperature: opts.temperature ?? 0.25,
        maxOutputTokens: opts.maxTokens ?? 2048,
      },
    };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (useTools) {
      body.tools = [
        {
          functionDeclarations: (opts.tools as ToolDefinition[]).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: toGeminiSchema(t.parameters),
          })),
        },
      ];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    let emitted = false;
    const onDelta = opts.onDelta
      ? (t: string) => {
          emitted = true;
          opts.onDelta!(t);
        }
      : undefined;

    return withRetry(
      () =>
        this.request(body, {
          signal: opts.signal,
          onDelta,
          stream: !!onDelta,
        }),
      {
        attempts: 2,
        shouldRetry: (err) => !emitted && (!(err instanceof AppError) || err.retryable),
        signal: opts.signal,
      },
    );
  }

  private async request(
    body: Record<string, unknown>,
    o: { signal?: AbortSignal; onDelta?: (t: string) => void; stream: boolean },
  ): Promise<ChatResult> {
    const method = o.stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:${method}${
      o.stream ? '?alt=sse' : ''
    }`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 180_000,
      signal: o.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 400 && /api key not valid|api_key_invalid/i.test(text)) {
        throw new AppError('INVALID_KEY', 'Google rejected the Gemini API key.', { status: 401, detail: text.slice(0, 400) });
      }
      throw mapHttpStatus(res.status, text);
    }

    const acc: ChatResult = { text: '', toolCalls: [] };
    let usage = { inputTokens: 0, outputTokens: 0 };
    let sawUsage = false;

    const consume = (json: any, isStream: boolean) => {
      if (json?.promptFeedback?.blockReason) {
        throw new AppError(
          'REFUSED',
          `The model refused this request (${json.promptFeedback.blockReason}).`,
          { status: 400 },
        );
      }
      const cand = json?.candidates?.[0];
      if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
        throw new AppError('REFUSED', 'The model refused this request on safety grounds.', { status: 400 });
      }
      for (const part of (cand?.content?.parts ?? []) as GeminiPart[]) {
        if (part.thought) continue;
        if (typeof part.text === 'string' && part.text) {
          acc.text += part.text;
          o.onDelta?.(part.text);
        }
        if (part.functionCall?.name) {
          acc.toolCalls.push({
            id: `gem_${acc.toolCalls.length}_${Date.now().toString(36)}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          });
        }
      }
      if (cand?.finishReason) acc.finishReason = cand.finishReason;
      const u = json?.usageMetadata;
      if (u) {
        sawUsage = true;
        usage.inputTokens += Number(u.promptTokenCount ?? 0);
        usage.outputTokens += Number(u.candidatesTokenCount ?? 0);
      }
      if (!cand && !json?.promptFeedback && !isStream) {
        throw new AppError('PROVIDER_ERROR', 'Gemini returned an empty response.', { status: 502, retryable: true });
      }
    };

    if (o.stream && res.body) {
      for await (const chunk of iterateSse(res.body)) {
        for (const data of sseData(chunk)) {
          const json = tryJson<any>(data);
          if (json) consume(json, true);
        }
      }
    } else {
      consume(await res.json(), false);
    }

    if (sawUsage) acc.usage = usage;
    return acc;
  }
}

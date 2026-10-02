import { AppError, mapHttpStatus } from '@/lib/errors';
import { fetchWithTimeout, withRetry } from '@/lib/http';
import { iterateSse, sseData, tryJson } from './sse';
import type { ChatOptions, ChatResult, LLMClient, ToolCall } from './types';

/**
 * Works with api.openai.com and any OpenAI-compatible endpoint
 * (Azure OpenAI, Groq, Together, OpenRouter, vLLM, Ollama, LM Studio, ...).
 */
export class OpenAIClient implements LLMClient {
  provider: string;
  label: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; model: string; baseUrl: string; provider?: string; label?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.provider = opts.provider ?? 'openai';
    this.label = opts.label ?? `OpenAI · ${opts.model}`;
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const useTools = opts.allowTools !== false && !!opts.tools?.length;
    const messages: Record<string, unknown>[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    for (const m of opts.messages) {
      if (m.role === 'system') {
        messages.push({ role: 'system', content: m.content });
      } else if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
          }));
        }
        messages.push(msg);
      } else {
        messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.25,
      max_tokens: opts.maxTokens ?? 2048,
      stream: !!opts.onDelta,
    };
    if (useTools) {
      body.tools = (opts.tools ?? []).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    let emitted = false;
    const onDelta = opts.onDelta
      ? (t: string) => {
          emitted = true;
          opts.onDelta!(t);
        }
      : undefined;

    return withRetry(
      () => this.request(body, { signal: opts.signal, onDelta, stream: !!onDelta }),
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
    const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      timeoutMs: 180_000,
      signal: o.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 400 && /invalid_api_key|incorrect api key/i.test(text)) {
        throw new AppError('INVALID_KEY', 'The LLM provider rejected the API key.', { status: 401, detail: text.slice(0, 400) });
      }
      if (res.status === 400 && /model/i.test(text) && /not found|does not exist|unknown/i.test(text)) {
        throw new AppError('MODEL_NOT_FOUND', `The provider does not offer "${this.model}".`, { status: 404, detail: text.slice(0, 400) });
      }
      throw mapHttpStatus(res.status, text);
    }

    const acc: ChatResult = { text: '', toolCalls: [] };
    const partial = new Map<number, { id: string; name: string; args: string }>();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let sawUsage = false;

    const applyUsage = (u: any) => {
      if (!u) return;
      sawUsage = true;
      usage.inputTokens += Number(u.prompt_tokens ?? 0);
      usage.outputTokens += Number(u.completion_tokens ?? 0);
    };

    const consume = (json: any) => {
      applyUsage(json?.usage);
      const choice = json?.choices?.[0];
      if (!choice) return;
      const msg = choice.message ?? choice.delta ?? {};
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) {
        acc.text += text;
        if (o.stream) o.onDelta?.(text);
      }
      const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
      if (reasoning && !text) {
        // some reasoning models stream chain-of-thought first — show it dimmed
        // only when there is no answer text at all yet.
        o.onDelta?.(reasoning);
      }
      for (const tc of msg.tool_calls ?? []) {
        const idx = Number(tc.index ?? 0);
        const entry = partial.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        partial.set(idx, entry);
      }
      if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    };

    if (o.stream && res.body) {
      for await (const chunk of iterateSse(res.body)) {
        for (const data of sseData(chunk)) {
          if (data === '[DONE]') continue;
          const json = tryJson<any>(data);
          if (json) consume(json);
        }
      }
    } else {
      consume(await res.json());
    }

    for (const [idx, entry] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
      const args = entry.args.trim() ? tryJson<Record<string, unknown>>(entry.args) ?? {} : {};
      if (args && typeof args === 'object' && typeof (args as any)._raw === 'string') {
        // ignore malformed payloads
      }
      const call: ToolCall = {
        id: entry.id || `oai_${idx}_${Date.now().toString(36)}`,
        name: entry.name,
        args,
      };
      if (call.name) acc.toolCalls.push(call);
    }

    if (sawUsage) acc.usage = usage;
    if (!acc.text && !acc.toolCalls.length) {
      throw new AppError('PROVIDER_ERROR', 'The LLM returned an empty response.', { status: 502, retryable: true });
    }
    return acc;
  }
}

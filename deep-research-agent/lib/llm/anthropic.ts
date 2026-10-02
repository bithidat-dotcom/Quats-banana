import { AppError, mapHttpStatus } from '@/lib/errors';
import { fetchWithTimeout, withRetry } from '@/lib/http';
import { iterateSse, sseData, tryJson } from './sse';
import type { ChatMessage, ChatOptions, ChatResult, LLMClient, ToolCall } from './types';

const DEFAULT_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

export class AnthropicClient implements LLMClient {
  provider = 'anthropic';
  label: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.label = `Anthropic · ${opts.model}`;
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const useTools = opts.allowTools !== false && !!opts.tools?.length;
    const messages = toAnthropicMessages(opts.messages);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.25,
      messages,
      stream: !!opts.onDelta,
    };
    if (opts.system) body.system = opts.system;
    if (useTools) {
      body.tools = (opts.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      body.tool_choice = { type: 'auto' };
    }

    let emitted = false;
    const onDelta = opts.onDelta
      ? (t: string) => {
          emitted = true;
          opts.onDelta!(t);
        }
      : undefined;

    return withRetry(() => this.request(body, { signal: opts.signal, onDelta, stream: !!onDelta }), {
      attempts: 2,
      shouldRetry: (err) => !emitted && (!(err instanceof AppError) || err.retryable),
      signal: opts.signal,
    });
  }

  private async request(
    body: Record<string, unknown>,
    o: { signal?: AbortSignal; onDelta?: (t: string) => void; stream: boolean },
  ): Promise<ChatResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      timeoutMs: 180_000,
      signal: o.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) {
        throw new AppError('INVALID_KEY', 'Anthropic rejected the API key.', { status: 401, detail: text.slice(0, 400) });
      }
      if (res.status === 404 && /model/i.test(text)) {
        throw new AppError('MODEL_NOT_FOUND', `Anthropic does not offer "${this.model}".`, { status: 404, detail: text.slice(0, 400) });
      }
      throw mapHttpStatus(res.status, text);
    }

    const acc: ChatResult = { text: '', toolCalls: [] };
    const partial = new Map<number, { id: string; name: string; json: string }>();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let sawUsage = false;

    const consumeEvent = (json: any) => {
      switch (json?.type) {
        case 'content_block_start': {
          const block = json.content_block as AnthropicBlock;
          if (block?.type === 'tool_use') {
            partial.set(json.index, { id: block.id ?? '', name: block.name ?? '', json: '' });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = json.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            acc.text += delta.text;
            o.onDelta?.(delta.text);
          } else if (delta?.type === 'input_json_delta') {
            const entry = partial.get(json.index);
            if (entry) entry.json += delta.partial_json ?? '';
          }
          break;
        }
        case 'message_delta': {
          const stop = json.delta?.stop_reason;
          if (stop) acc.finishReason = stop;
          if (json.usage) {
            sawUsage = true;
            usage.outputTokens += Number(json.usage.output_tokens ?? 0);
          }
          break;
        }
        case 'message_start': {
          if (json.message?.usage) {
            sawUsage = true;
            usage.inputTokens += Number(json.message.usage.input_tokens ?? 0);
            usage.outputTokens += Number(json.message.usage.output_tokens ?? 0);
          }
          break;
        }
        default:
          break;
      }
    };

    const consumeFull = (json: any) => {
      if (json?.error) {
        throw new AppError('PROVIDER_ERROR', json.error.message ?? 'Anthropic returned an error.', { status: 502 });
      }
      for (const block of (json?.content ?? []) as AnthropicBlock[]) {
        if (block.type === 'text' && block.text) {
          acc.text += block.text;
          o.onDelta?.(block.text);
        } else if (block.type === 'tool_use' && block.name) {
          acc.toolCalls.push({
            id: block.id ?? `ant_${acc.toolCalls.length}`,
            name: block.name,
            args: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
      if (json?.stop_reason) acc.finishReason = json.stop_reason;
      const u = json?.usage;
      if (u) {
        sawUsage = true;
        usage.inputTokens += Number(u.input_tokens ?? 0);
        usage.outputTokens += Number(u.output_tokens ?? 0);
      }
    };

    if (o.stream && res.body) {
      for await (const chunk of iterateSse(res.body)) {
        for (const data of sseData(chunk)) {
          const json = tryJson<any>(data);
          if (json) consumeEvent(json);
        }
      }
      for (const [idx, entry] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
        if (!entry.name) continue;
        acc.toolCalls.push({
          id: entry.id || `ant_${idx}_${Date.now().toString(36)}`,
          name: entry.name,
          args: entry.json.trim() ? tryJson<Record<string, unknown>>(entry.json) ?? {} : {},
        });
      }
    } else {
      consumeFull(await res.json());
    }

    if (sawUsage) acc.usage = usage;
    if (!acc.text && !acc.toolCalls.length) {
      throw new AppError('PROVIDER_ERROR', 'Anthropic returned an empty response.', { status: 502, retryable: true });
    }
    return acc;
  }
}

function toAnthropicMessages(messages: ChatMessage[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  let pendingToolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];

  const flush = () => {
    if (pendingToolResults.length) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      pendingToolResults.push({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
      continue;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
      continue;
    }
    const blocks: unknown[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const call of m.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
    }
    out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '(no output)' }] });
  }
  flush();

  // Anthropic requires the first message to be from the user.
  if (out.length === 0 || out[0].role !== 'user') {
    out.unshift({ role: 'user', content: [{ type: 'text', text: 'Begin.' }] });
  }
  return out;
}

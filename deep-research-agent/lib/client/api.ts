'use client';

import type { Depth, EvidenceItem, Report, StreamEvent } from '@/lib/types';

export interface Credentials {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  searchProvider?: string;
  searchKey?: string;
}

export interface ResearchRequestBody {
  question: string;
  depth: Depth;
  sessionId: string;
  prior?: { question: string; report: Report; evidence: EvidenceItem[] };
  creds: Credentials;
}

export interface StreamError {
  code: string;
  message: string;
  hint?: string;
}

const TIMEOUTS = { default: 5000 };

function credentialHeaders(creds: Credentials): Record<string, string> {
  const h: Record<string, string> = {};
  if (creds.provider) h['x-dr-llm-provider'] = creds.provider;
  if (creds.model) h['x-dr-llm-model'] = creds.model;
  if (creds.apiKey) h['x-dr-llm-key'] = creds.apiKey;
  if (creds.baseUrl) h['x-dr-llm-base-url'] = creds.baseUrl;
  if (creds.searchProvider) h['x-dr-search-provider'] = creds.searchProvider;
  if (creds.searchKey) h['x-dr-search-key'] = creds.searchKey;
  return h;
}

async function readError(res: Response): Promise<StreamError> {
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string; hint?: string } };
    if (json?.error?.message) {
      return {
        code: json.error.code ?? 'INTERNAL',
        message: json.error.message,
        hint: json.error.hint,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    code: res.status === 429 ? 'RATE_LIMIT' : 'INTERNAL',
    message:
      res.status === 429
        ? 'Too many requests — wait a moment and try again.'
        : `The server returned an error (${res.status}).`,
  };
}

/**
 * POST /api/research and consume the Server-Sent Events stream.
 * Returns when the stream ends or the caller aborts.
 */
export async function streamResearch(
  body: ResearchRequestBody,
  handlers: { onEvent: (event: StreamEvent) => void; onError: (error: StreamError) => void },
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credentialHeaders(body.creds) },
      body: JSON.stringify({
        question: body.question,
        depth: body.depth,
        sessionId: body.sessionId,
        prior: body.prior,
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError({
      code: 'NETWORK',
      message: 'Could not reach the server. Is the dev server still running?',
    });
    return;
  }

  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    handlers.onError(await readError(res));
    return;
  }
  if (!res.body) {
    handlers.onError({ code: 'INTERNAL', message: 'The server sent an empty stream.' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line || line.startsWith(':')) continue;
        try {
          handlers.onEvent(JSON.parse(line) as StreamEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      handlers.onError({ code: 'NETWORK', message: 'The connection to the server was interrupted.' });
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export interface PublicConfigShape {
  llm: {
    defaultProvider: string;
    defaultModel: string;
    catalog: { id: string; label: string; envKeys: string[]; defaultModel: string; suggestedModels: string[]; needsBaseUrl?: boolean }[];
    available: Record<string, boolean>;
    serverKeyConfigured: boolean;
  };
  search: {
    defaultProvider: string;
    options: { id: string; label: string; envKeys: string[]; signupUrl: string }[];
    available: Record<string, boolean>;
    serverKeyConfigured: boolean;
  };
  defaults: { depth: Depth };
  demoEnabled: boolean;
  limits: { rateLimitMax: number; windowSec: number; maxConcurrent: number };
}

export async function fetchConfig(signal?: AbortSignal): Promise<PublicConfigShape | undefined> {
  try {
    const res = await fetch('/api/config', { signal, cache: 'no-store' });
    if (!res.ok) return undefined;
    return (await res.json()) as PublicConfigShape;
  } catch {
    return undefined;
  }
}

export async function testLlmKey(creds: Credentials): Promise<{ ok: boolean; message: string; label?: string }> {
  try {
    const res = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credentialHeaders(creds) },
      body: JSON.stringify({}),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; label?: string; error?: { message?: string; hint?: string } };
    if (json.ok) return { ok: true, message: json.message ?? 'Connected.', label: json.label };
    return { ok: false, message: `${json.error?.message ?? 'The key was rejected.'}${json.error?.hint ? ` ${json.error.hint}` : ''}` };
  } catch {
    return { ok: false, message: 'Could not reach the server to test the key.' };
  }
}

/** Download a report as a file rendered by the server (md / pdf / txt). */
export async function downloadReport(
  format: 'md' | 'pdf' | 'txt',
  report: Report,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/report/${format}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ report }),
    });
    if (!res.ok) {
      const err = await readError(res);
      return { ok: false, message: `${err.message}${err.hint ? ` ${err.hint}` : ''}` };
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? `deep-research-report.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true };
  } catch {
    return { ok: false, message: 'The download failed. Check your connection and try again.' };
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function openPrintView(report: Report, markdown: string): void {
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
  if (!win) return;
  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${report.title.replace(/[<>&]/g, '')}</title>
  <style>
    body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:46rem;margin:48px auto;padding:0 20px;color:#111}
    h1{font-size:1.7rem;line-height:1.25} h2{margin-top:1.8rem;font-size:1.2rem} h3{font-size:1.02rem;margin-bottom:.3rem;color:#222}
    blockquote{margin:.6rem 0;padding:.5rem .9rem;background:#f4f4f5;border-left:3px solid #a5b4fc;color:#333;font-size:.9rem}
    li{margin:.25rem 0} a{color:#4338ca;word-break:break-word} hr{border:none;border-top:1px solid #ddd;margin:1.6rem 0}
  </style></head><body>${escaped}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
  win.document.close();
}

/** Small helper for a guaranteed-fast header request timeout. */
export const DEFAULT_TIMEOUT = TIMEOUTS.default;

/** Tiny SSE client used by every streaming provider adapter. */

export async function* iterateSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string, void, unknown> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (chunk.trim()) yield chunk;
      }
    }
    if (buf.trim()) yield buf;
  } finally {
    reader.releaseLock?.();
  }
}

/** Extract all `data:` payloads from one SSE event block. */
export function sseData(chunk: string): string[] {
  const out: string[] = [];
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.trimStart();
    if (!line.startsWith('data:')) continue;
    out.push(line.slice(5).replace(/^ /, ''));
  }
  return out;
}

export function tryJson<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

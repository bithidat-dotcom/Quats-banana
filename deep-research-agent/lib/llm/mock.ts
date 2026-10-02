import type { Depth } from '@/lib/types';
import type { ChatOptions, ChatResult, LLMClient, ToolCall } from './types';

/**
 * Offline "demo" model. It follows the same agent protocol as a real LLM
 * (plans → searches → reads → writes JSON) but every decision is scripted, so
 * the app can be demoed end-to-end without any API key. It only ever reasons
 * over text the tools actually returned, so it cannot invent sources either.
 */
export class MockLLM implements LLMClient {
  provider = 'demo';
  label = 'Demo (offline, sample sources)';
  model: string;

  constructor(
    private opts: {
      question: string;
      surface: 'planner' | 'research' | 'writer';
      depth: Depth;
      /** URLs already known, used by the writer to respect prior sources. */
      priorSources?: { n: number; title: string; url: string }[];
    },
  ) {
    this.model = 'demo-scripted';
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    await delay(220);
    if (opts.signal?.aborted) throw new Error('Aborted');
    if (this.opts.surface === 'planner') return this.plan(opts);
    if (this.opts.surface === 'writer') return this.write(opts);
    return this.research(opts);
  }

  /* ------------------------------------------------------------ planner */

  private plan(opts: ChatOptions): ChatResult {
    const keywords = keywordsOf(this.opts.question);
    const q = this.opts.question;
    const plan = {
      question_restated: q.endsWith('?') ? q : `${q} (scope: public, verifiable information)`,
      understanding:
        'Demo mode: the planner is scripted and works only with the bundled sample sources. Add an LLM key in Settings to get a real research plan.',
      sub_questions: [
        `What do authoritative sources state about ${keywords}?`,
        `How recent are those figures and what is the trend?`,
        `Where do sources disagree about ${keywords}?`,
      ],
      search_queries: [
        `${keywords} overview`,
        `${keywords} statistics 2025`,
        `${keywords} cost trend`,
      ],
      key_claims: [
        `The main quantitative claim in the question about ${keywords} must be double-sourced.`,
        'Any trend statement must carry a date.',
      ],
      priority_sources: ['Government statistics', 'Peer-reviewed studies', 'Reputable news wires'],
      safe: true,
      safety_note: null,
    };
    emit(opts, 'Planning from the question keywords.');
    return { text: JSON.stringify(plan), toolCalls: [] };
  }

  /* ----------------------------------------------------------- research */

  private research(opts: ChatOptions): ChatResult {
    const calls = opts.messages.flatMap((m) => (m.role === 'assistant' ? m.toolCalls ?? [] : []));
    const searches = calls.filter((c) => c.name === 'web_search');
    const fetches = calls.filter((c) => c.name === 'fetch_page');
    const keywords = keywordsOf(this.opts.question);

    // Scan every tool result (not just the newest one): after a page has been
    // read its text replaces the search listing, so URLs have to be collected
    // across the whole transcript.
    const allToolContent = opts.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (m as { content: string }).content)
      .join('\n');

    // 1) Search first — from three different angles, like the real agent.
    if (searches.length < 3) {
      const angles = [
        `${keywords} overview`,
        `${keywords} statistics 2025`,
        `${keywords} cost trend`,
      ];
      const call: ToolCall = {
        id: `mock_search_${searches.length}`,
        name: 'web_search',
        args: { query: angles[Math.min(searches.length, angles.length - 1)], max_results: 5 },
      };
      emit(opts, `\nSearching for "${call.args.query}"…\n`);
      return { text: '', toolCalls: [call] };
    }

    // 2) Then read pages in full.
    const candidateUrls = extractResultUrls(allToolContent).filter(
      (url) => !calls.some((c) => c.name === 'fetch_page' && String((c.args as { url?: unknown })?.url) === url),
    );
    const wanted = this.opts.depth === 'quick' ? 2 : this.opts.depth === 'standard' ? 3 : 4;
    if (fetches.length < wanted && candidateUrls.length) {
      const call: ToolCall = {
        id: `mock_fetch_${fetches.length}`,
        name: 'fetch_page',
        args: { url: candidateUrls[0] },
      };
      emit(opts, `\nReading ${candidateUrls[0]}…\n`);
      return { text: '', toolCalls: [call] };
    }

    // 3) Then hand over to the writer.
    const ids = extractIds(opts.messages);
    emit(opts, `\nI have read ${fetches.length} sources (${ids.length} with citable text) and can answer.\n`);
    return {
      text: `RESEARCH COMPLETE. Evidence gathered from ${fetches.length} opened pages; citation ids available: ${ids
        .map((i) => `[${i}]`)
        .join(', ')}. Key claims are supported by at least two of the sample sources. Ready to write the report.`,
      toolCalls: [],
    };
  }

  /* ------------------------------------------------------------- writer */

  private write(opts: ChatOptions): ChatResult {
    const userMsg = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const question = (userMsg.match(/# Question\n([\s\S]*?)\n\n#/)?.[1] ?? this.opts.question).trim();
    const sources = parseDigestSources(userMsg);

    if (!sources.length) {
      return {
        text: JSON.stringify({
          title: 'No evidence found',
          short_answer:
            'Demo mode could not find any usable source for this question, so no answer is reported. Add a search API key in Settings to search the live web.',
          confidence: 'low',
          confidence_reason: 'No source text was available to the agent.',
          findings: [],
          sources: [],
          conflicts: [],
          uncertainties: ['No sources were retrieved.'],
          follow_up_questions: [],
        }),
        toolCalls: [],
      };
    }

    const findings = sources.slice(0, 3).map((s) => {
      const sentences = s.body
        .split(/(?<=[.!?])\s+/)
        .map((x) => x.trim())
        .filter(
          (x) =>
            x.length > 60 && x.length < 320 && !x.startsWith('Demo mode') && !x.includes('DEMO SAMPLE DOCUMENT'),
        );
      const bullets = (sentences.length ? sentences.slice(0, 3) : [s.body.slice(0, 220)]).map(
        (t) => `${stripIds(t)} [${s.n}]`,
      );
      return { heading: s.title, bullets };
    });

    const report = {
      title: `${question.replace(/[?.]+$/, '')} — researched summary`,
      short_answer: `Across the ${sources.length} sources the agent read: ${sources
        .slice(0, 2)
        .map((s) => {
          const sentences = s.body.split(/(?<=[.!?])\s+/).map((x) => x.trim());
          const pick = sentences.find((x) => x.length > 70 && !x.includes('DEMO SAMPLE')) ?? sentences[0] ?? '';
          return stripIds(pick).slice(0, 170);
        })
        .join(' ')} [${sources[0].n}]. This is demo output built from the bundled sample pages, not a live-web answer.`,
      confidence: 'medium' as const,
      confidence_reason: `Demo mode: ${sources.length} sample sources with readable text; figures are cross-checked where they overlap.`,
      findings,
      sources: sources.map((s) => ({
        id: s.n,
        title: s.title,
        url: s.url,
        date: s.date,
        type: s.url.includes('.gov') ? 'government' : s.url.includes('.edu') ? 'academic' : 'other',
        supports: `Provides figures and context used in the key findings.`,
        quote: '',
      })),
      conflicts: sources.length > 1 ? [] : ['Only one source was available, so nothing could be cross-checked.'],
      uncertainties: [
        'Demo mode uses bundled sample pages instead of the live web.',
        'Add an LLM key and a search key in Settings for real research.',
      ],
      follow_up_questions: [
        'How have these figures changed over the last five years?',
        'Which regions lead and which lag behind?',
      ],
    };

    emit(opts, JSON.stringify(report, null, 2));
    return { text: JSON.stringify(report), toolCalls: [] };
  }
}

/* ------------------------------------------------------------------ utils */

function emit(opts: ChatOptions, text: string) {
  opts.onDelta?.(text);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const STOPWORDS = new Set(
  ['what', 'which', 'who', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'be', 'been', 'it', 'its', 'that', 'this', 'these', 'those', 'with', 'about', 'from', 'by', 'at', 'as', 'vs', 'versus', 'best', 'most', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'tell', 'give', 'explain', 'compare', 'please'].map((w) => w),
);

function keywordsOf(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const picked = words.slice(0, 5);
  return picked.length ? picked.join(' ') : question.slice(0, 60);
}

function extractResultUrls(content: string): string[] {
  const urls: string[] = [];
  const re = /https?:\/\/[^\s)\]"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const u = m[0].replace(/[.,;]+$/, '');
    if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

function extractIds(messages: ChatOptions['messages']): number[] {
  const ids = new Set<number>();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const re = /^\[(\d+)\]/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(m.content))) ids.add(Number(match[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

function parseDigestSources(userMsg: string) {
  const out: { n: number; title: string; url: string; date: string; body: string }[] = [];
  const blocks = userMsg.split(/\n(?=\[\d+\]\s)/);
  for (const block of blocks) {
    const head = /^\[(\d+)\]\s+"([^"]*)"\s+—\s+(?:\([^)]*\)\s+)?(\S+)/.exec(block.trim());
    if (!head) continue;
    const date = /published:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(block)?.[1] ?? '';
    const body = block
      // strip the digest header line: [3] "Title" — (fetch) https://url
      .replace(/^\[[^\]]*\]\s*"[^"]*"\s*—\s*\([^)]*\)[ \t]*\S+/, '')
      // drop the digest metadata lines (published / domain / text / snippet markers)
      .replace(/(^|\n)[ \t]*(?:published|domain|text|snippet):[^\n]*/g, '\n')
      .replace(/\n\s*/g, ' ')
      .trim();
    out.push({ n: Number(head[1]), title: head[2], url: head[3], date, body: body.slice(0, 4000) });
  }
  return out;
}

function stripIds(text: string): string {
  return text.replace(/\s*\[\d+\]/g, '').trim();
}

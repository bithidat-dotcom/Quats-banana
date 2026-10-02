import type { Confidence, EvidenceItem, Report, ReportFinding, ReportSource } from '@/lib/types';

/* ------------------------------------------------------------- extraction */

/** Pull the first complete JSON object out of a model reply. */
export function extractJsonObject(text: string): any | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Scan for balanced braces, respecting strings and escapes.
  const start = cleaned.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return tryParse(cleaned.slice(start, i + 1));
    }
  }
  return undefined;
}

function tryParse(text: string): any | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    // Some models emit trailing commas or smart quotes.
    try {
      const repaired = text
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      const parsed = JSON.parse(repaired);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

/* ------------------------------------------------------------ validation */

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

function asString(v: unknown, max = 4000): string {
  if (typeof v === 'string') return v.trim().slice(0, max);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function asStringArray(v: unknown, maxItems = 20, maxLen = 700): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asString(x, maxLen))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

export function citationIds(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export function stripUnknownCitations(text: string, allowed: Set<number>): { text: string; removed: number[] } {
  const removed: number[] = [];
  const out = text.replace(/\s*\[(\d{1,3})\](?=[\s.,;:)]|$)/g, (match, d: string) => {
    const n = Number(d);
    if (allowed.has(n)) return match;
    removed.push(n);
    return '';
  });
  return { text: out.replace(/ {2,}/g, ' ').trim(), removed };
}

const STOPWORDS = new Set(
  'the a an and or of to in for on with by from as at is are was were be been being that this these those it its their there here which who whom whose what when where why how not no nor but if then than so such can could may might must should would will shall do does did done have has had also more most very about into over under between across during per via using used use new news'.split(
    ' ',
  ),
);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- main pass */

export interface BuildReportOptions {
  question: string;
  evidence: EvidenceItem[];
  raw: any;
  degraded?: boolean;
  fallbackText?: string;
}

export function buildReport(opts: BuildReportOptions): { report: Report; notes: string[] } {
  const notes: string[] = [];
  const byId = new Map(opts.evidence.map((e) => [e.n, e]));
  const allowed = new Set(byId.keys());
  const raw = opts.raw ?? {};

  const findings: ReportFinding[] = [];
  for (const f of Array.isArray(raw.findings) ? raw.findings : []) {
    const heading = asString(f?.heading, 200) || 'Findings';
    const bullets = asStringArray(f?.bullets, 12, 900);
    if (bullets.length) findings.push({ heading, bullets });
  }

  // ---- sources: keep only ids that exist in our evidence -----------------
  const sources: ReportSource[] = [];
  const seen = new Set<number>();
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const id = Number(s?.id ?? s?.n);
    const ev = byId.get(id);
    if (!ev) {
      if (Number.isFinite(id)) notes.push(`Dropped a source the model listed as [${id}] because it is not in the retrieved evidence.`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    let quote = asString(s?.quote, 600);
    if (quote) {
      const haystack = normalizeForMatch(ev.text ?? ev.snippet ?? '');
      if (!haystack.includes(normalizeForMatch(quote))) {
        notes.push(`Removed a quote attributed to [${id}] ("${quote.slice(0, 60)}…") because it does not appear verbatim in that source.`);
        quote = '';
      }
    }
    sources.push({
      n: id,
      title: asString(s?.title, 300) || ev.title,
      url: ev.url, // always trust the URL we actually retrieved
      domain: ev.domain,
      date: asString(s?.date, 32) || ev.publishedDate || '',
      type: asString(s?.type, 40) || classifySource(ev),
      supports: asString(s?.supports, 400),
      quote: quote || undefined,
    });
  }

  // ---- citations in prose must reference known ids -----------------------
  const cleanText = (t: string) => {
    const { text, removed } = stripUnknownCitations(t, allowed);
    if (removed.length) notes.push(`Removed citation${removed.length > 1 ? 's' : ''} [${[...new Set(removed)].join('], [')}] that pointed at sources the agent never retrieved.`);
    return text;
  };

  const shortAnswerRaw = asString(raw.short_answer, 4000) || asString(opts.fallbackText, 4000);
  const shortAnswer = cleanText(shortAnswerRaw);
  const cleanedFindings = findings.map((f) => ({
    heading: f.heading,
    bullets: f.bullets.map(cleanText).filter(Boolean),
  }));

  // ---- renumber citations to 1..N in order of first appearance ----------
  const order: number[] = [];
  const scan = (t: string) => {
    for (const n of citationIds(t)) if (!order.includes(n)) order.push(n);
  };
  scan(shortAnswer);
  cleanedFindings.forEach((f) => f.bullets.forEach(scan));
  asStringArray(raw.conflicts, 10, 700).map(cleanText).forEach(scan);
  asStringArray(raw.uncertainties, 10, 700).map(cleanText).forEach(scan);
  sources.forEach((s) => {
    scan(s.supports);
    if (s.quote) scan(s.quote);
  });

  const map = new Map(order.map((old, i) => [old, i + 1]));
  const remap = (t: string) =>
    t.replace(/\[(\d{1,3})\]/g, (m, d: string) => {
      const nn = map.get(Number(d));
      return nn ? `[${nn}]` : m;
    });

  const remappedSources = sources
    .filter((s) => map.has(s.n))
    .map((s) => ({
      ...s,
      n: map.get(s.n)!,
      supports: remap(s.supports),
      quote: s.quote ? remap(s.quote) : undefined,
    }))
    .sort((a, b) => a.n - b.n);

  const uncitedRead = opts.evidence.filter((e) => e.fetched && !order.includes(e.n)).length;

  const confidence: Confidence = CONFIDENCES.includes(raw.confidence) ? raw.confidence : 'medium';

  const report: Report = {
    title: asString(raw.title, 200) || titleFromQuestion(opts.question),
    question: opts.question,
    shortAnswer: shortAnswer || 'No answer could be produced from the retrieved evidence.',
    confidence,
    confidenceReason: asString(raw.confidence_reason, 500) || 'No justification was given by the writing model.',
    findings: cleanedFindings
      .map((f) => ({ heading: f.heading, bullets: f.bullets.map(remap) }))
      .filter((f) => f.bullets.length),
    sources: remappedSources,
    conflicts: asStringArray(raw.conflicts, 10, 700).map(cleanText).map(remap),
    uncertainties: asStringArray(raw.uncertainties, 10, 700).map(cleanText).map(remap),
    followUpQuestions: asStringArray(raw.follow_up_questions, 5, 200).map(remap),
    generatedAt: new Date().toISOString(),
    degraded: opts.degraded,
    integrityNotes: notes,
    methodology: [
      `${opts.evidence.length} source${opts.evidence.length === 1 ? '' : 's'} seen, ${opts.evidence.filter((e) => e.fetched).length} read in full, ${remappedSources.length} cited.`,
      uncitedRead ? `Note: ${uncitedRead} source(s) were read but not cited.` : '',
      opts.degraded ? 'Note: the report was assembled from the agent’s raw output because its JSON could not be parsed.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  };

  return { report, notes };
}

function classifySource(ev: EvidenceItem): string {
  const d = ev.domain;
  if (/\.(gov|gov\.[a-z]{2}|mil)$/.test(d) || /(^|\.)(europa|un|who|imf|worldbank|oecd)\./.test(d)) return 'government';
  if (/\.(edu|ac\.[a-z]{2})$/.test(d) || /(arxiv|nature|science|jstor|pubmed|ncbi|springer|sciencedirect|doi)\./.test(d)) return 'academic';
  if (/(reuters|apnews|bbc|ft|wsj|bloomberg|nytimes|guardian|aljazeera|npr|cnn)\./.test(d)) return 'news';
  if (/(company|corp|inc)\./.test(d)) return 'company';
  if (/(docs|developer|readthedocs|github)\./.test(d)) return 'documentation';
  return 'other';
}

export function titleFromQuestion(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ');
  const short = q.length > 80 ? `${q.slice(0, 77)}…` : q;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/**
 * Support audit: does each cited source actually contain the vocabulary of
 * the claim it is cited for? Catches invented or mis-attributed claims.
 */
export function auditSupport(report: Report, evidence: EvidenceItem[]): string[] {
  const byId = new Map(evidence.map((e) => [e.n, e]));
  const notes: string[] = [];
  const remapped = report.sources.map((s) => ({ id: s.n, words: contentWords(byId.get(s.n)?.text ?? byId.get(s.n)?.snippet ?? '') }));

  const check = (text: string, where: string) => {
    const ids = citationIds(text);
    if (!ids.length) return;
    const claimWords = new Set(contentWords(text));
    if (claimWords.size < 4) return;
    let best = 0;
    for (const id of ids) {
      const src = remapped.find((r) => r.id === id);
      if (!src) continue;
      let hits = 0;
      for (const w of claimWords) if (src.words.includes(w)) hits++;
      best = Math.max(best, hits / claimWords.size);
    }
    if (best < 0.4) {
      notes.push(
        `${where}: the claim “${text.slice(0, 90)}${text.length > 90 ? '…' : ''}” cites [${ids.join(', [')}] but those sources' text does not clearly contain those terms — verify manually.`,
      );
    }
  };

  check(report.shortAnswer, 'Short answer');
  for (const f of report.findings) {
    for (const b of f.bullets) check(b, `Finding “${f.heading}”`);
    if (notes.length >= 6) break;
  }
  return notes.slice(0, 6);
}

/** Fallback report when the writer never produced parseable JSON. */
export function buildDegradedReport(args: {
  question: string;
  evidence: EvidenceItem[];
  rawText: string;
  reason: string;
}): Report {
  const read = args.evidence.filter((e) => e.fetched);
  const summary = args.rawText.replace(/\s+/g, ' ').trim().slice(0, 1500);
  return {
    title: titleFromQuestion(args.question),
    question: args.question,
    shortAnswer: summary || 'The agent gathered sources but could not compose the final answer.',
    confidence: 'low',
    confidenceReason: args.reason,
    findings: read.length
      ? [
          {
            heading: 'Sources read (no structured summary could be generated)',
            bullets: read.slice(0, 8).map((e, i) => `${e.title} — ${e.domain}${e.publishedDate ? `, ${e.publishedDate}` : ''} [${i + 1}]`),
          },
        ]
      : [],
    sources: read.slice(0, 8).map((e, i) => ({
      n: i + 1,
      title: e.title,
      url: e.url,
      domain: e.domain,
      date: e.publishedDate ?? '',
      type: classifySource(e),
      supports: 'Read by the agent; cited in the source list only.',
    })),
    conflicts: [],
    uncertainties: [
      'The writing step failed to produce a structured report.',
      'Re-run the research, or ask a narrower question.',
    ],
    followUpQuestions: [],
    generatedAt: new Date().toISOString(),
    degraded: true,
    integrityNotes: [args.reason],
    methodology: `${args.evidence.length} sources seen, ${read.length} read in full.`,
  };
}

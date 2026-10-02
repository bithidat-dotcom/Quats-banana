import type { EvidenceItem, SearchResult } from '@/lib/types';

/** Strip tracking noise so the same page is never counted twice. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|igshid|si)$/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Rough source-quality signal used for ordering the evidence digest. */
export function sourceTier(domain: string): number {
  if (/\.(gov|gov\.[a-z]{2}|mil|europa\.eu|un\.org|who\.int|imf\.org|worldbank\.org|oecd\.org)$/.test(domain)) return 0;
  if (/\.(edu|ac\.[a-z]{2}|arxiv\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|jstor\.org|pubmed|ncbi\.nlm\.nih\.gov|doi\.org)$/.test(domain)) return 1;
  if (/^(reuters|apnews|bbc|ft|wsj|bloomberg|economist|nytimes|washingtonpost|theguardian|aljazeera|npr)\.(com|co\.uk|org)$/.test(domain)) return 2;
  return 3;
}

export class EvidenceStore {
  private byKey = new Map<string, EvidenceItem>();
  private items: EvidenceItem[] = [];
  private counter = 0;

  constructor(prior: EvidenceItem[] = []) {
    for (const item of prior) {
      const key = canonicalizeUrl(item.url);
      if (this.byKey.has(key)) continue;
      this.counter += 1;
      const clone: EvidenceItem = { ...item, n: this.counter, origin: 'prior' };
      this.byKey.set(key, clone);
      this.items.push(clone);
    }
  }

  get size(): number {
    return this.items.length;
  }

  all(): EvidenceItem[] {
    return this.items;
  }

  byId(n: number): EvidenceItem | undefined {
    return this.items.find((i) => i.n === n);
  }

  get(url: string): EvidenceItem | undefined {
    return this.byKey.get(canonicalizeUrl(url));
  }

  /** Register search results; returns the (possibly existing) items. */
  addResults(results: SearchResult[], query: string): { item: EvidenceItem; isNew: boolean }[] {
    const out: { item: EvidenceItem; isNew: boolean }[] = [];
    for (const r of results) {
      const key = canonicalizeUrl(r.url);
      const existing = this.byKey.get(key);
      if (existing) {
        if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
        if (!existing.publishedDate && r.publishedDate) existing.publishedDate = r.publishedDate;
        out.push({ item: existing, isNew: false });
        continue;
      }
      this.counter += 1;
      const item: EvidenceItem = {
        n: this.counter,
        url: r.url,
        title: r.title || domainOf(r.url),
        domain: domainOf(r.url),
        publishedDate: r.publishedDate,
        snippet: r.snippet,
        fetched: false,
        origin: 'search',
        query,
      };
      this.byKey.set(key, item);
      this.items.push(item);
      out.push({ item, isNew: true });
    }
    return out;
  }

  /** Attach the full text of a page that has just been read. */
  attachText(
    url: string,
    data: { title?: string; text: string; publishedDate?: string; truncated?: boolean; chars: number },
  ): EvidenceItem {
    const key = canonicalizeUrl(url);
    let item = this.byKey.get(key);
    if (!item) {
      this.counter += 1;
      item = {
        n: this.counter,
        url,
        title: data.title || domainOf(url),
        domain: domainOf(url),
        fetched: false,
        origin: 'fetch',
      };
      this.byKey.set(key, item);
      this.items.push(item);
    }
    if (data.title && (!item.title || item.title.length < 3)) item.title = data.title;
    item.text = data.text;
    item.textChars = data.chars;
    item.fetched = true;
    item.truncated = data.truncated;
    if (data.publishedDate && !item.publishedDate) item.publishedDate = data.publishedDate;
    return item;
  }

  readable(): EvidenceItem[] {
    return this.items.filter((i) => i.fetched && !!i.text && i.text.length > 120);
  }

  /** Items that only ever appeared as search results. */
  snippetsOnly(): EvidenceItem[] {
    return this.items.filter((i) => !i.fetched);
  }

  /**
   * Build the evidence digest handed to the writing model.
   * Read sources come first, best-quality first; snippets fill the remainder.
   */
  digest(opts: { maxItems: number; maxCharsPerItem: number }): string {
    const rank = (i: EvidenceItem) => (i.fetched ? 0 : 100) + sourceTier(i.domain) * 10 + Math.min(i.n, 9) * 0.1;
    const chosen = [...this.items].sort((a, b) => rank(a) - rank(b)).slice(0, opts.maxItems);

    const blocks = chosen.map((i) => {
      const meta: string[] = [];
      if (i.publishedDate) meta.push(`published: ${i.publishedDate}`);
      else meta.push('published: (undated)');
      meta.push(`domain: ${i.domain}`);
      if (i.fetched) {
        meta.push(`read in full (${i.textChars ?? i.text?.length ?? 0} chars${i.truncated ? ', truncated' : ''})`);
      } else {
        meta.push('search snippet only — NOT read in full');
      }
      const body = i.fetched
        ? `text:\n${(i.text ?? '').slice(0, opts.maxCharsPerItem)}`
        : `snippet:\n${(i.snippet ?? '(no snippet)').slice(0, 400)}`;
      return `[${i.n}] "${i.title}" — ${i.fetched ? '(fetch)' : '(snippet)'} ${i.url}\n    ${meta.join(' · ')}\n${indent(body)}`;
    });

    const read = chosen.filter((i) => i.fetched).length;
    const header = `Digest: ${chosen.length} sources (${read} read in full, ${chosen.length - read} snippets only). Numbers in brackets are citation ids.`;
    return `${header}\n\n${blocks.join('\n\n')}`;
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

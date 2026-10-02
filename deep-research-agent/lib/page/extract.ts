import { AppError } from '@/lib/errors';

/** Strip scripts/styles/tags without a DOM library (fallback path). */
export function stripHtmlFallback(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main =
    /<article[\s\S]*?<\/article>/i.exec(withoutHidden)?.[0] ??
    /<main[\s\S]*?<\/main>/i.exec(withoutHidden)?.[0] ??
    withoutHidden;
  return decodeEntities(
    main
      .replace(/<\/(p|div|section|li|h[1-6]|tr|br|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  times: '×',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Collapse whitespace while keeping paragraph breaks readable. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0\u2007\u202f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

export interface ExtractedArticle {
  title?: string;
  text: string;
  excerpt?: string;
  byline?: string;
  publishedDate?: string;
  siteName?: string;
  readabilityFailed?: boolean;
}

/** Heuristic date extraction from meta tags / JSON-LD / visible text. */
export function guessPublishedDate(html: string, url: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["'](?:pubdate|publishdate|publication_date|date|DC\.date|DC\.date\.issued|sailthru\.date|article:published_time)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:updated_time["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) {
      const iso = toIsoDate(m[1]);
      if (iso) return iso;
    }
  }
  // visible date near the top of the document, e.g. "12 March 2025"
  const head = html.replace(/<[^>]+>/g, ' ').slice(0, 4000);
  const visible = /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/.exec(
    head,
  );
  if (visible?.[1]) {
    const iso = toIsoDate(visible[1]);
    if (iso) return iso;
  }
  const urlDate = /\/(20\d{2})\/(0?[1-9]|1[0-2])\//.exec(url);
  if (urlDate) return `${urlDate[1]}-${urlDate[2].padStart(2, '0')}-01`;
  return undefined;
}

export function toIsoDate(input: string): string | undefined {
  const t = input.trim();
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed) && parsed > 0) {
    const d = new Date(parsed);
    if (d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * Extract the readable article body from raw HTML.
 * Uses Mozilla Readability (same engine as Firefox Reader View) and falls back
 * to a tag-stripping pass when it fails or returns too little text.
 */
export async function extractFromHtml(html: string, url: string): Promise<ExtractedArticle> {
  const publishedDate = guessPublishedDate(html, url);
  let title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  title = title ? normalizeWhitespace(decodeEntities(title)) : undefined;

  let readabilityText = '';
  let meta: Partial<ExtractedArticle> = {};
  try {
    // Loaded lazily: jsdom is heavy and not needed for PDFs or plain text.
    const { JSDOM, VirtualConsole } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');
    const virtualConsole = new VirtualConsole(); // swallow page errors
    const dom = new JSDOM(html, {
      url,
      virtualConsole,
      // Do NOT run scripts or load subresources from untrusted pages.
      runScripts: undefined,
      resources: undefined,
      pretendToBeVisual: false,
    });
    const doc = dom.window.document;
    const metaTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? undefined;
    const byline = doc.querySelector('meta[name="author"]')?.getAttribute('content') ?? undefined;

    const article = new Readability(doc, { charThreshold: 250, keepClasses: false }).parse();
    if (article?.textContent) readabilityText = article.textContent;
    meta = {
      title: metaTitle?.trim() || article?.title?.trim() || title,
      excerpt: article?.excerpt ?? undefined,
      byline: article?.byline ?? byline,
      siteName,
    };
    dom.window.close();
  } catch {
    // JSdom can throw on very broken markup — fall through to the regex path.
  }

  const fallbackText = stripHtmlFallback(html);
  const best = readabilityText.length >= 400 ? readabilityText : fallbackText;
  const text = normalizeWhitespace(best);

  if (text.length < 80) {
    throw new AppError(
      'PAGE_BLOCKED',
      'The page returned almost no readable text (it may be a paywall, a JavaScript-only app, or a bot check).',
      { status: 422 },
    );
  }

  return {
    title: meta.title || title,
    text,
    excerpt: meta.excerpt,
    byline: meta.byline,
    publishedDate,
    siteName: meta.siteName,
    readabilityFailed: readabilityText.length < 400,
  };
}

/** Extract text from a PDF buffer using unpdf (bundled pdf.js, no workers). */
export async function extractFromPdf(buffer: Uint8Array): Promise<ExtractedArticle> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(buffer);
    const { text, totalPages } = await extractText(doc, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n\n') : String(text ?? '');
    const titleMatch = /^(.{5,140})$/m.exec(merged.split('\n').find((l) => l.trim().length > 12) ?? '');
    const normalized = normalizeWhitespace(merged);
    if (normalized.length < 80) {
      throw new AppError('PAGE_BLOCKED', 'The PDF contained no extractable text (it may be scanned images).', {
        status: 422,
      });
    }
    return {
      title: titleMatch?.[1]?.trim(),
      text: `${normalized}\n\n[PDF, ${totalPages} page${totalPages === 1 ? '' : 's'}]`,
      publishedDate: undefined,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNSUPPORTED_TYPE', 'That PDF could not be parsed.', {
      status: 422,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export function looksLikePdf(buffer: Uint8Array, contentType: string): boolean {
  if (contentType.toLowerCase().includes('application/pdf')) return true;
  return buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
}

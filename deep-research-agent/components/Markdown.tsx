'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * Small dependency-free Markdown renderer for streamed model output and
 * report bodies. Supports headings, bullets, numbered lists, blockquotes,
 * rules, bold/italic/code/link spans and [n] citations (which link to the
 * matching source card on the page). Everything is rendered as React text,
 * so no HTML from the model is ever executed.
 */

function Inline({ text, keyPrefix }: { text: string; keyPrefix: string }): ReactNode {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    const re = /(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[\d{1,3}\])/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = re.exec(text))) {
      if (match.index > last) out.push(text.slice(last, match.index));
      const token = match[0];
      const key = `${keyPrefix}-i${i++}`;
      if (/^\[\d{1,3}\]$/.test(token)) {
        const n = token.slice(1, -1);
        out.push(
          <a
            key={key}
            href={`#source-${n}`}
            className="citation-pill"
            title={`Jump to source ${n}`}
            aria-label={`Source ${n}`}
          >
            {n}
          </a>,
        );
      } else if (token.startsWith('**')) {
        out.push(
          <strong key={key} className="font-semibold text-slate-900 dark:text-slate-100">
            {token.slice(2, -2)}
          </strong>,
        );
      } else if (token.startsWith('`')) {
        out.push(
          <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800">
            {token.slice(1, -1)}
          </code>,
        );
      } else if (token.startsWith('[')) {
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
        if (link) {
          out.push(
            <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer nofollow">
              {link[1]}
            </a>,
          );
        } else {
          out.push(token);
        }
      } else if (token.startsWith('*')) {
        out.push(<em key={key}>{token.slice(1, -1)}</em>);
      } else {
        out.push(token);
      }
      last = match.index + token.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, keyPrefix]);

  return <>{nodes}</>;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'h':
            return block.level === 1 ? (
              <h3 key={key} className="mt-6 mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                <Inline text={block.text} keyPrefix={key} />
              </h3>
            ) : block.level === 2 ? (
              <h4 key={key} className="mt-5 mb-1.5 text-base font-semibold text-slate-900 dark:text-white">
                <Inline text={block.text} keyPrefix={key} />
              </h4>
            ) : (
              <h5 key={key} className="mt-4 mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Inline text={block.text} keyPrefix={key} />
              </h5>
            );
          case 'ul':
            return (
              <ul key={key} className="my-2 list-disc space-y-1 pl-5 marker:text-slate-400">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>
                    <Inline text={item} keyPrefix={`${key}-${i}`} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="my-2 list-decimal space-y-1 pl-5 marker:text-slate-400">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>
                    <Inline text={item} keyPrefix={`${key}-${i}`} />
                  </li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-3 border-l-2 border-indigo-300 bg-indigo-50/40 px-3 py-2 text-sm text-slate-600 dark:border-indigo-800 dark:bg-indigo-950/20 dark:text-slate-300"
              >
                <Inline text={block.text} keyPrefix={key} />
              </blockquote>
            );
          case 'hr':
            return <hr key={key} className="my-5 border-slate-200 dark:border-slate-800" />;
          default:
            return (
              <p key={key} className="my-2.5">
                <Inline text={block.text} keyPrefix={key} />
              </p>
            );
        }
      })}
    </div>
  );
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | undefined;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'p', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = undefined;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h', level: Math.min(3, heading[1].length), text: heading[2] });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'hr' });
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'quote', text: trimmed.replace(/^>\s?/, '') });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    // continuation of the current list item (indented line)
    if (list && /^\s{2,}/.test(line) && list.items.length) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

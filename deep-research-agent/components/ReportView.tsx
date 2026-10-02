'use client';

import { useState } from 'react';
import { formatDuration } from '@/lib/client/store';
import type { Report, Round } from '@/lib/types';
import {
  IconAlert,
  IconBook,
  IconCheck,
  IconCopy,
  IconDownload,
  IconFile,
  IconSparkles,
  IconShield,
} from './Icons';
import { Button, Pill } from './ui';
import { Markdown } from './Markdown';

const CONFIDENCE: Record<Report['confidence'], { tone: 'green' | 'amber' | 'rose'; label: string }> = {
  high: { tone: 'green', label: 'High confidence' },
  medium: { tone: 'amber', label: 'Medium confidence' },
  low: { tone: 'rose', label: 'Low confidence' },
};

export interface ReportActions {
  onCopy: () => void;
  onCopySources: () => void;
  onDownload: (format: 'md' | 'pdf' | 'txt') => void;
  onPrint: () => void;
  busy?: string;
}

export function ReportView({
  round,
  report,
  actions,
  onFollowUp,
}: {
  round: Round;
  report: Report;
  actions: ReportActions;
  onFollowUp: (question: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const confidence = CONFIDENCE[report.confidence] ?? CONFIDENCE.medium;
  const stats = round.stats;

  return (
    <article className="animate-fade-in space-y-4">
      {report.degraded ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="flex items-center gap-2 font-semibold">
            <IconAlert size={16} /> Partial report
          </p>
          <p className="mt-1 leading-relaxed">
            {report.integrityNotes?.[0] ?? 'The writing step did not finish cleanly, so this report was assembled from what the agent gathered.'}
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-snug text-slate-900 dark:text-white sm:text-2xl">{report.title}</h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{report.question}</p>
          </div>
          <Pill tone={confidence.tone} className="shrink-0 px-3 py-1 text-[0.7rem]">
            <IconShield size={13} /> {confidence.label}
          </Pill>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={actions.onCopy} title="Copy the report as Markdown">
            <IconCopy size={15} /> Copy
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.onDownload('md')} loading={actions.busy === 'md'}>
            <IconFile size={15} /> Markdown
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.onDownload('pdf')} loading={actions.busy === 'pdf'}>
            <IconDownload size={15} /> PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.onPrint}>
            Print
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.onCopySources}>
            <IconBook size={15} /> Copy sources
          </Button>
        </div>

        <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Short answer</h3>
          <Markdown text={report.shortAnswer} className="report-body" />
        </div>

        <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
          Why this confidence: {report.confidenceReason}
        </p>

        {stats ? (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {stats.searches} searches · {stats.pagesRead} pages opened ({stats.pagesFailed} blocked) · {stats.steps} agent steps ·{' '}
            {formatDuration(stats.elapsedMs)}
            {stats.inputTokens + stats.outputTokens > 0
              ? ` · ${(stats.inputTokens + stats.outputTokens).toLocaleString()} tokens`
              : ''}
          </p>
        ) : null}
      </div>

      {report.findings.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Key findings</h3>
          <div className="mt-3 space-y-5">
            {report.findings.map((finding, index) => (
              <div key={`${finding.heading}-${index}`} className="print-block">
                <h4 className="text-base font-semibold text-slate-900 dark:text-white">{finding.heading}</h4>
                <ul className="mt-2 space-y-2">
                  {finding.bullets.map((bullet, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                      <Markdown text={bullet} className="report-body min-w-0 flex-1" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(report.conflicts?.length || report.uncertainties?.length) ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            <IconAlert size={15} /> Conflicts and uncertainty
          </h3>
          <ul className="mt-3 space-y-2.5">
            {(report.conflicts ?? []).map((c, i) => (
              <li key={`c${i}`} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <div className="min-w-0 flex-1">
                  <Markdown text={c} className="text-[0.95rem] leading-7 text-amber-900 dark:text-amber-100" />
                </div>
              </li>
            ))}
            {(report.uncertainties ?? []).map((u, i) => (
              <li key={`u${i}`} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <div className="min-w-0 flex-1">
                  <Markdown text={u} className="text-[0.95rem] leading-7 text-amber-900 dark:text-amber-100" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.integrityNotes?.length && !report.degraded ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <IconShield size={14} /> Integrity checks
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {report.integrityNotes.map((note, i) => (
              <li key={i}>• {note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.sources.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <button
            onClick={() => setSourcesOpen((v) => !v)}
            aria-expanded={sourcesOpen}
            className="focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <IconBook size={15} /> Sources
              <Pill tone="slate">{report.sources.length}</Pill>
            </span>
            <span className="text-xs text-slate-400">{sourcesOpen ? 'Hide' : 'Show'}</span>
          </button>
          {sourcesOpen ? (
            <ol className="space-y-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              {report.sources.map((source) => (
                <li
                  key={source.n}
                  id={`source-${source.n}`}
                  className="print-block scroll-mt-24 rounded-xl border border-slate-100 p-3 transition target:border-indigo-300 target:bg-indigo-50/40 dark:border-slate-800 dark:target:border-indigo-800 dark:target:bg-indigo-950/30"
                >
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800">
                      {source.n}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="break-words font-medium text-slate-800 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        {source.title}
                      </a>
                      <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">
                        {source.domain || source.url}
                        {source.date ? ` · ${source.date}` : ' · undated'}
                        {source.type ? ` · ${source.type}` : ''}
                      </p>
                      {source.supports ? (
                        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-slate-600 dark:text-slate-300">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Supports: </span>
                          <Markdown text={source.supports} className="inline" />
                        </p>
                      ) : null}
                      {source.quote ? (
                        <blockquote className="mt-1.5 border-l-2 border-slate-200 pl-3 text-[0.8125rem] italic text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          “{source.quote}”
                        </blockquote>
                      ) : null}
                    </div>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="focus-ring mt-0.5 hidden shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 sm:block"
                      aria-label={`Open ${source.title}`}
                    >
                      <IconSparkles size={14} />
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {report.methodology ? (
        <p className="px-1 text-xs leading-relaxed text-slate-400 dark:text-slate-500">{report.methodology}</p>
      ) : null}

      {report.followUpQuestions?.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <IconCheck size={14} /> Suggested follow-ups
          </h3>
          <div className="flex flex-wrap gap-2">
            {report.followUpQuestions.map((q) => (
              <button
                key={q}
                onClick={() => onFollowUp(q)}
                className="focus-ring rounded-full border border-slate-200 px-3 py-1.5 text-left text-[0.8125rem] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

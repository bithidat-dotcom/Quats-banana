'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatClock, formatDuration, hostOf } from '@/lib/client/store';
import type { Phase, Round, TimelineItem } from '@/lib/types';
import { IconAlert, IconBook, IconCheck, IconChevron, IconClock, IconGlobe, IconSearch, IconShield, IconSpinner } from './Icons';
import { Pill } from './ui';
import { Markdown } from './Markdown';

const STEPS: { id: Phase; label: string }[] = [
  { id: 'planning', label: 'Plan' },
  { id: 'searching', label: 'Search' },
  { id: 'reading', label: 'Read' },
  { id: 'verifying', label: 'Verify' },
  { id: 'writing', label: 'Write' },
];

const PHASE_ORDER: Phase[] = ['planning', 'searching', 'reading', 'verifying', 'writing'];

export function ProgressView({ round, running, onStop }: { round: Round; running: boolean; onStop: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const statuses = round.timeline.filter((t): t is Extract<TimelineItem, { kind: 'status' }> => t.kind === 'status');
  const lastStatus = statuses[statuses.length - 1];
  const phase: Phase = lastStatus?.phase ?? 'planning';
  const phaseIndex = Math.max(0, PHASE_ORDER.indexOf(phase));

  const searches = round.timeline.filter((t): t is Extract<TimelineItem, { kind: 'search' }> => t.kind === 'search');
  const reads = round.timeline.filter((t): t is Extract<TimelineItem, { kind: 'read' }> => t.kind === 'read');
  const readsByUrl = useMemo(() => {
    const map = new Map<string, Extract<TimelineItem, { kind: 'read' }>>();
    for (const r of reads) map.set(r.url, r);
    return map;
  }, [reads]);
  const notes = round.timeline.filter((t): t is Extract<TimelineItem, { kind: 'note' }> => t.kind === 'note');
  const verifies = round.timeline.filter((t): t is Extract<TimelineItem, { kind: 'verify' }> => t.kind === 'verify');

  const pagesOk = [...readsByUrl.values()].filter((r) => r.status === 'ok').length;
  const pagesFailed = [...readsByUrl.values()].filter((r) => r.status === 'error').length;
  const elapsed = (round.finishedAt ?? (running ? now : Date.now())) - round.startedAt;

  const live = (round.streamingReport ?? '').slice(-2600);

  return (
    <div className="animate-fade-in space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-indigo-600 dark:text-indigo-400">
            {running ? <IconSpinner size={20} /> : <IconCheck size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-medium text-slate-900 dark:text-white">
              {lastStatus?.message ?? (running ? 'Starting…' : 'Finished')}
            </p>
            {lastStatus?.detail ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{lastStatus.detail}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <IconClock size={13} /> {formatDuration(elapsed)}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconSearch size={13} /> {searches.length} searches
              </span>
              <span className="inline-flex items-center gap-1">
                <IconBook size={13} /> {pagesOk} pages read
                {pagesFailed ? ` · ${pagesFailed} blocked` : ''}
              </span>
              {round.stats ? <span>{round.stats.inputTokens + round.stats.outputTokens > 0 ? `${(round.stats.inputTokens + round.stats.outputTokens).toLocaleString()} tokens` : ''}</span> : null}
            </div>

            {/* phase steps */}
            <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {STEPS.map((step, index) => {
                const done = index < phaseIndex || (!running && round.status === 'done');
                const active = index === phaseIndex && running;
                return (
                  <li key={step.id} className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-medium ring-1 ring-inset ${
                        active
                          ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800'
                          : done
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900'
                            : 'bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:ring-slate-800'
                      }`}
                    >
                      {active ? <IconSpinner size={11} /> : done ? <IconCheck size={11} /> : null}
                      {step.label}
                    </span>
                    {index < STEPS.length - 1 ? <span className="hidden h-px w-3 bg-slate-200 dark:bg-slate-700 sm:block" /> : null}
                  </li>
                );
              })}
            </ol>
          </div>

          {running ? (
            <button
              onClick={onStop}
              className="focus-ring shrink-0 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              Stop
            </button>
          ) : null}
        </div>

        {/* live output */}
        {live && (running || round.streamingReport) ? (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              onClick={() => setLiveOpen((v) => !v)}
              className="focus-ring flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <span>Live output {running ? '· streaming' : '· archived'}</span>
              <IconChevron size={14} className={liveOpen ? 'rotate-180 transition' : 'transition'} />
            </button>
            {liveOpen ? (
              <div className="thin-scroll mt-2 max-h-56 overflow-y-auto rounded-xl bg-slate-50 p-3 text-[0.8rem] leading-relaxed text-slate-600 dark:bg-slate-950/60 dark:text-slate-400">
                <Markdown text={live} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* collapsible detail */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <button
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          className="focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
        >
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Agent activity
            <Pill tone="slate">{searches.length} searches</Pill>
            <Pill tone="slate">{pagesOk} pages</Pill>
            {pagesFailed ? <Pill tone="rose">{pagesFailed} blocked</Pill> : null}
            {notes.length ? <Pill tone="amber">{notes.length} notes</Pill> : null}
          </span>
          <IconChevron size={16} className={`shrink-0 text-slate-400 ${detailsOpen ? 'rotate-180 transition' : 'transition'}`} />
        </button>

        {detailsOpen ? (
          <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <IconSearch size={13} /> Searches
              </h4>
              {searches.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No searches yet.</p>
              ) : (
                <ul className="space-y-2">
                  {searches.map((s) => (
                    <SearchRow key={s.id} item={s} />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <IconGlobe size={13} /> Pages opened
              </h4>
              {readsByUrl.size === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No pages opened yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {[...readsByUrl.values()].map((r) => (
                    <li key={r.id} className="flex items-start gap-2 rounded-lg px-1 py-1.5 text-sm">
                      <span className={`mt-1 ${r.status === 'error' ? 'text-rose-500' : r.status === 'start' ? 'text-indigo-500' : 'text-emerald-500'}`}>
                        {r.status === 'start' ? <IconSpinner size={12} /> : r.status === 'ok' ? <IconCheck size={13} /> : <IconAlert size={13} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="break-words font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
                        >
                          {r.title || hostOf(r.url)}
                        </a>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                          {hostOf(r.url)}
                          {r.status === 'ok' && r.chars ? ` · ${r.chars.toLocaleString()} chars` : ''}
                          {r.date ? ` · ${r.date}` : ''}
                          {r.truncated ? ' · truncated' : ''}
                          {r.ms ? ` · ${r.ms} ms` : ''}
                        </span>
                        {r.error ? <span className="mt-0.5 block text-xs text-rose-600 dark:text-rose-400">{r.error}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {verifies.length ? (
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <IconShield size={13} /> Verification
                </h4>
                <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                  {verifies.map((v) => (
                    <li key={v.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-950/50">
                      {v.text}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {notes.length ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</h4>
                <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {notes.map((n) => (
                    <li key={n.id} className="flex gap-2">
                      <span className="shrink-0 font-mono">{formatClock(n.at)}</span>
                      <span className="min-w-0 break-words">{n.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchRow({ item }: { item: Extract<TimelineItem, { kind: 'search' }> }) {
  const [open, setOpen] = useState(false);
  const failed = !!item.error;
  return (
    <li className="rounded-xl border border-slate-100 dark:border-slate-800">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <span className={`mt-0.5 ${failed ? 'text-rose-500' : 'text-slate-400'}`}>
          {failed ? <IconAlert size={14} /> : <IconSearch size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{item.query}</span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {failed ? item.error : `${item.count} results · ${item.provider}${item.ms ? ` · ${item.ms} ms` : ''}`}
          </span>
        </span>
        {item.count > 0 ? (
          <IconChevron size={14} className={`mt-0.5 shrink-0 text-slate-400 ${open ? 'rotate-180 transition' : 'transition'}`} />
        ) : null}
      </button>
      {open && item.results.length ? (
        <ul className="space-y-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          {item.results.map((r, i) => (
            <li key={`${r.url}-${i}`} className="text-sm">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
              >
                {r.title}
              </a>
              <span className="mt-0.5 block break-words text-xs text-slate-500 dark:text-slate-400">
                {r.domain}
                {r.date ? ` · ${r.date}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

'use client';

import type { PublicConfigShape } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/store';
import type { Session } from '@/lib/types';
import { IconPlus, IconSettings, IconSparkles, IconTrash, IconX } from './Icons';
import { Button } from './ui';

export function Sidebar({
  sessions,
  activeId,
  open,
  config,
  onClose,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
}: {
  sessions: Session[];
  activeId?: string;
  open: boolean;
  config?: PublicConfigShape;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const needsSearchKey = config && !config.search.serverKeyConfigured;
  const needsLlmKey = config && !config.llm.serverKeyConfigured && config.llm.defaultProvider !== 'demo';

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[2px] lg:hidden" onClick={onClose} aria-hidden="true" />
      ) : null}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-[17.5rem] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
        }`}
        aria-label="Research history"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <IconSparkles size={18} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Deep Research</p>
              <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">agent</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Close menu"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="px-4">
          <Button variant="primary" className="w-full justify-start" onClick={onNew}>
            <IconPlus size={16} /> New research
          </Button>
        </div>

        {(needsSearchKey || needsLlmKey) && (
          <button
            onClick={onOpenSettings}
            className="focus-ring mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span className="font-semibold">Add API keys</span>
            <span className="mt-0.5 block opacity-90">
              {needsLlmKey && needsSearchKey
                ? 'An LLM key and a search key are needed for live research.'
                : needsLlmKey
                  ? 'Add an LLM key to run real research.'
                  : 'Add a search key to search the live web.'}
            </span>
          </button>
        )}

        <div className="thin-scroll mt-3 flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            History
          </p>
          {sessions.length === 0 ? (
            <p className="px-3 py-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Your researches will appear here. They are stored in this browser only.
            </p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => {
                const active = session.id === activeId;
                const rounds = session.rounds.length;
                const running = session.rounds.some((r) => r.status === 'running');
                return (
                  <li key={session.id}>
                    <div
                      className={`group flex items-start gap-2 rounded-xl px-2.5 py-2 transition ${
                        active
                          ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(session.id)}>
                        <span
                          className={`line-clamp-2 block text-[0.8125rem] font-medium ${
                            active ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {session.title}
                        </span>
                        <span className="mt-0.5 block text-[0.7rem] text-slate-500 dark:text-slate-400">
                          {running ? 'researching…' : relativeTime(session.updatedAt)} · {rounds}{' '}
                          {rounds === 1 ? 'question' : 'questions'}
                        </span>
                      </button>
                      <button
                        onClick={() => onDelete(session.id)}
                        className="focus-ring rounded-lg p-1 text-slate-400 opacity-0 transition hover:bg-white hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-900"
                        aria-label={`Delete ${session.title}`}
                        title="Delete"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            onClick={onOpenSettings}
            className="focus-ring flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <IconSettings size={16} /> Settings
          </button>
          <p className="px-2 pt-1 text-[0.68rem] leading-relaxed text-slate-400 dark:text-slate-500">
            API keys stay on the server. History stays in this browser.
          </p>
        </div>
      </aside>
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  copyText,
  downloadReport,
  fetchConfig,
  openPrintView,
  streamResearch,
  type PublicConfigShape,
} from '@/lib/client/api';
import {
  DEFAULT_PREFS,
  applyTheme,
  createSession,
  formatDuration,
  loadPrefs,
  loadSessions,
  newId,
  savePrefs,
  saveSessions,
  type Prefs,
} from '@/lib/client/store';
import { reportToMarkdown, sourcesToMarkdown } from '@/lib/report/markdown';
import type { Depth, Round, Session, StreamEvent, TimelineItem } from '@/lib/types';
import {
  IconBook,
  IconCheck,
  IconChevron,
  IconMenu,
  IconMoon,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles,
  IconSun,
} from './Icons';
import { ProgressView } from './ProgressView';
import { QuestionBox } from './QuestionBox';
import { ReportView, type ReportActions } from './ReportView';
import { SettingsModal } from './SettingsModal';
import { Sidebar } from './Sidebar';
import { Button, ErrorBanner, Pill } from './ui';

const EXAMPLES = [
  'How does the EU AI Act define a general-purpose model, and what obligations kick in?',
  'What is the current evidence on four-day work weeks?',
  'Compare grid-scale battery storage costs in 2025 with 2020',
  'What changed in the WHO air quality guidelines and why?',
];

const ERROR_TITLES: Record<string, string> = {
  MISSING_KEY: 'Missing API key',
  INVALID_KEY: 'API key rejected',
  RATE_LIMIT: 'Rate limit',
  QUOTA: 'Quota exhausted',
  NO_RESULTS: 'No results',
  PAGE_BLOCKED: 'Page blocked',
  UNSUPPORTED_TYPE: 'Unsupported file type',
  TIMEOUT: 'Timed out',
  NETWORK: 'Network problem',
  MODEL_NOT_FOUND: 'Model unavailable',
  REFUSED: 'Request declined',
  BLOCKED_ADDRESS: 'Blocked address',
  BAD_REQUEST: 'Invalid request',
  PROVIDER_ERROR: 'Provider error',
  INTERNAL: 'Something went wrong',
};

export default function DeepResearchApp() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [config, setConfig] = useState<PublicConfigShape | undefined>();
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [runningRoundId, setRunningRoundId] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [banner, setBanner] = useState<
    { title: string; message: string; hint?: string; tone?: 'rose' | 'amber' | 'sky' } | undefined
  >();
  const [toast, setToast] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  /** Which session/round the in-flight run belongs to (for delete-during-run). */
  const runningHandleRef = useRef<{ sessionId: string; roundId: string } | null>(null);
  const pendingDelta = useRef<{ sessionId: string; roundId: string; text: string }>({
    sessionId: '',
    roundId: '',
    text: '',
  });

  /* ------------------------------------------------------------- hydrate */
  useEffect(() => {
    const loadedPrefs = loadPrefs();
    setPrefs(loadedPrefs);
    applyTheme(loadedPrefs.theme);
    setDepth(loadedPrefs.defaultDepth);
    const loaded = loadSessions();
    setSessions(loaded);
    setActiveId(loaded[0]?.id);
    setHydrated(true);

    const controller = new AbortController();
    fetchConfig(controller.signal).then((cfg) => {
      if (!cfg) return;
      setConfig(cfg);
      setPrefs((current) => ({
        ...current,
        llmProvider: current.llmProvider || cfg.llm.defaultProvider,
        llmModel: current.llmModel || cfg.llm.defaultModel,
      }));
    });
    return () => controller.abort();
  }, []);

  /* ------------------------------------------------------------- persist */
  useEffect(() => {
    if (!hydrated) return;
    savePrefs(prefs);
  }, [prefs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => saveSessions(sessions), 400);
    return () => clearTimeout(timer);
  }, [sessions, hydrated]);

  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [prefs.theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ------------------------------------------------------ state helpers */
  const updateSession = (sessionId: string, fn: (session: Session) => Session) => {
    setSessions((list) => list.map((s) => (s.id === sessionId ? fn(s) : s)));
  };

  const updateRound = (sessionId: string, roundId: string, fn: (round: Round) => Round) => {
    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      rounds: session.rounds.map((r) => (r.id === roundId ? fn(r) : r)),
    }));
  };

  const pushTimeline = (sessionId: string, roundId: string, item: TimelineItem) => {
    updateRound(sessionId, roundId, (round) => ({ ...round, timeline: [...round.timeline, item] }));
  };

  const flushDeltas = () => {
    const pending = pendingDelta.current;
    if (!pending.text) return;
    const chunk = pending.text;
    pending.text = '';
    updateRound(pending.sessionId, pending.roundId, (round) => ({
      ...round,
      streamingReport: `${round.streamingReport ?? ''}${chunk}`,
    }));
  };

  const updatePrefs = (patch: Partial<Prefs>) => setPrefs((current) => ({ ...current, ...patch }));

  /* -------------------------------------------------------------- events */
  const handleEvent = (sessionId: string, roundId: string, event: StreamEvent) => {
    switch (event.type) {
      case 'session':
        updateSession(sessionId, (session) => ({
          ...session,
          provider: event.provider,
          model: event.model,
          depth: event.depth,
        }));
        break;
      case 'status':
        pushTimeline(sessionId, roundId, {
          id: newId('t'),
          kind: 'status',
          at: Date.now(),
          message: event.message,
          phase: event.phase,
          detail: event.detail,
        });
        break;
      case 'plan':
        updateRound(sessionId, roundId, (round) => ({ ...round, plan: event.plan }));
        pushTimeline(sessionId, roundId, {
          id: newId('t'),
          kind: 'status',
          at: Date.now(),
          phase: 'searching',
          message: 'Research plan ready',
          detail: event.plan.subQuestions.slice(0, 3).join(' · '),
        });
        break;
      case 'search':
        pushTimeline(sessionId, roundId, {
          id: newId('t'),
          kind: 'search',
          at: Date.now(),
          query: event.query,
          provider: event.provider,
          count: event.count,
          ms: event.ms,
          error: event.error,
          results: event.results,
        });
        break;
      case 'read':
        if (event.status === 'start') {
          pushTimeline(sessionId, roundId, {
            id: newId('t'),
            kind: 'read',
            at: Date.now(),
            url: event.url,
            status: 'start',
          });
        } else {
          updateRound(sessionId, roundId, (round) => {
            const timeline = [...round.timeline];
            for (let i = timeline.length - 1; i >= 0; i -= 1) {
              const item = timeline[i];
              if (item.kind === 'read' && item.status === 'start') {
                timeline[i] = {
                  ...item,
                  url: event.status === 'ok' ? event.url : item.url,
                  title: event.title,
                  status: event.status,
                  chars: event.chars,
                  date: event.date,
                  error: event.error,
                  ms: event.ms,
                  truncated: event.truncated,
                };
                break;
              }
            }
            return { ...round, timeline };
          });
        }
        break;
      case 'verify':
        pushTimeline(sessionId, roundId, { id: newId('t'), kind: 'verify', at: Date.now(), text: event.text });
        break;
      case 'note':
        pushTimeline(sessionId, roundId, { id: newId('t'), kind: 'note', at: Date.now(), message: event.message });
        break;
      case 'report_delta': {
        const pending = pendingDelta.current;
        if (pending.roundId !== roundId) pendingDelta.current = { sessionId, roundId, text: event.text };
        else pending.text += event.text;
        break;
      }
      case 'report':
        flushDeltas();
        updateRound(sessionId, roundId, (round) => ({ ...round, report: event.report, evidence: event.evidence }));
        break;
      case 'stats':
        updateRound(sessionId, roundId, (round) => ({ ...round, stats: event.stats }));
        break;
      case 'error':
        setBanner({
          title: ERROR_TITLES[event.code] ?? 'Something went wrong',
          message: event.message,
          hint: event.hint,
          tone: event.code === 'REFUSED' ? 'sky' : event.code === 'RATE_LIMIT' ? 'amber' : 'rose',
        });
        updateRound(sessionId, roundId, (round) => ({
          ...round,
          error: { code: event.code, message: event.message, hint: event.hint },
          status: event.code === 'REFUSED' ? 'refused' : 'error',
        }));
        break;
      case 'done':
        updateRound(sessionId, roundId, (round) => ({
          ...round,
          status:
            event.reason === 'complete' || event.reason === 'timeout'
              ? 'done'
              : event.reason === 'refused'
                ? 'refused'
                : event.reason === 'stopped'
                  ? 'stopped'
                  : 'error',
          finishedAt: Date.now(),
          streamingReport: undefined,
        }));
        break;
      default:
        break;
    }
  };

  /* --------------------------------------------------------------- start */
  const startResearch = async (rawQuestion: string, opts?: { followUp?: boolean }) => {
    const text = rawQuestion.trim();
    if (text.length < 3 || runningRef.current) return;

    const currentSession = sessions.find((s) => s.id === activeId);
    const priorRound = opts?.followUp
      ? [...(currentSession?.rounds ?? [])].reverse().find((r) => r.report)
      : undefined;
    const kind: Round['kind'] = priorRound ? 'followup' : 'research';

    let sessionId = currentSession?.id;
    if (!sessionId) {
      const created = createSession(depth, prefs.llmProvider, prefs.llmModel, text);
      sessionId = created.id;
      setSessions((list) => [created, ...list]);
      setActiveId(created.id);
    }

    const roundId = newId('r');
    const round: Round = {
      id: roundId,
      question: text,
      depth,
      kind,
      status: 'running',
      startedAt: Date.now(),
      timeline: [],
    };

    setSessions((list) =>
      list.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: session.rounds.length === 0 ? text.slice(0, 90) : session.title,
              depth,
              provider: prefs.llmProvider || session.provider,
              model: prefs.llmModel || session.model,
              updatedAt: Date.now(),
              rounds: [...session.rounds, round],
            }
          : session,
      ),
    );

    setBanner(undefined);
    setQuestion('');
    setRunningRoundId(roundId);
    runningRef.current = true;
    runningHandleRef.current = { sessionId, roundId };

    const controller = new AbortController();
    abortRef.current = controller;
    const flushTimer = setInterval(flushDeltas, 140);
    let sawDone = false;

    try {
      await streamResearch(
        {
          question: text,
          depth,
          sessionId,
          prior:
            priorRound?.report
              ? {
                  question: priorRound.question,
                  report: priorRound.report,
                  evidence: priorRound.evidence ?? [],
                }
              : undefined,
          creds: {
            provider: prefs.llmProvider || undefined,
            model: prefs.llmModel || undefined,
            apiKey: prefs.llmKey || undefined,
            baseUrl: prefs.llmBaseUrl || undefined,
            searchProvider:
              prefs.searchProvider && prefs.searchProvider !== 'auto' ? prefs.searchProvider : undefined,
            searchKey: prefs.searchKey || undefined,
          },
        },
        {
          onEvent: (event) => {
            if (event.type === 'done') sawDone = true;
            handleEvent(sessionId!, roundId, event);
          },
          onError: (error) => {
            setBanner({
              title: ERROR_TITLES[error.code] ?? 'Something went wrong',
              message: error.message,
              hint: error.hint,
              tone: error.code === 'RATE_LIMIT' ? 'amber' : 'rose',
            });
            updateRound(sessionId!, roundId, (current) => ({
              ...current,
              status: 'error',
              finishedAt: Date.now(),
              error: { code: error.code, message: error.message, hint: error.hint },
            }));
          },
        },
        controller.signal,
      );
    } finally {
      clearInterval(flushTimer);
      flushDeltas();
      abortRef.current = null;
      runningRef.current = false;
      runningHandleRef.current = null;
      setRunningRoundId(undefined);
      if (!sawDone) {
        updateRound(sessionId, roundId, (current) =>
          current.status === 'running'
            ? {
                ...current,
                status: controller.signal.aborted ? 'stopped' : 'error',
                finishedAt: Date.now(),
                error: controller.signal.aborted
                  ? undefined
                  : { code: 'NETWORK', message: 'The connection ended before the report was finished.' },
              }
            : { ...current, finishedAt: current.finishedAt ?? Date.now() },
        );
      }
    }
  };

  const stopResearch = () => {
    abortRef.current?.abort();
    setToast('Stopping…');
  };

  const deleteSession = (id: string) => {
    // Stop the run first if it belongs to the session being deleted.
    if (runningHandleRef.current?.sessionId === id) abortRef.current?.abort();
    setSessions((list) => list.filter((s) => s.id !== id));
    setActiveId((current) => (current === id ? undefined : current));
  };

  const newResearch = () => {
    setActiveId(undefined);
    setQuestion('');
    setBanner(undefined);
    updatePrefs({ sidebarOpen: false });
  };

  const clearHistory = () => {
    setSessions([]);
    setActiveId(undefined);
    setToast('History cleared.');
  };

  /* ------------------------------------------------------------- derived */
  const activeSession = sessions.find((s) => s.id === activeId);
  const rounds = activeSession?.rounds ?? [];
  const running = !!runningRoundId;
  const providerLabel = (() => {
    const id = prefs.llmProvider || config?.llm.defaultProvider || '';
    const entry = config?.llm.catalog.find((p) => p.id === id);
    const model =
      prefs.llmModel || (id && id === config?.llm.defaultProvider ? config.llm.defaultModel : entry?.defaultModel);
    return `${entry?.label ?? (id || 'LLM')}${model ? ` · ${model}` : ''}`;
  })();
  const demoOnly = (prefs.llmProvider || config?.llm.defaultProvider) === 'demo';
  const searchKeyMissing = !!config && !config.search.serverKeyConfigured && !prefs.searchKey;

  const reportActionsFor = (round: Round | undefined): ReportActions => ({
    busy: busyAction,
    onCopy: async () => {
      if (!round?.report) return;
      const ok = await copyText(reportToMarkdown(round.report));
      setToast(ok ? 'Report copied as Markdown.' : 'Copy failed — select the text manually.');
    },
    onCopySources: async () => {
      if (!round?.report) return;
      const ok = await copyText(sourcesToMarkdown(round.report));
      setToast(ok ? 'Source list copied.' : 'Copy failed.');
    },
    onDownload: async (format) => {
      if (!round?.report) return;
      setBusyAction(format);
      const result = await downloadReport(format, round.report);
      setBusyAction(undefined);
      if (!result.ok) setBanner({ title: 'Download failed', message: result.message, tone: 'amber' });
      else setToast(format === 'pdf' ? 'PDF downloaded.' : 'Markdown downloaded.');
    },
    onPrint: () => {
      if (!round?.report) return;
      openPrintView(round.report, reportToMarkdown(round.report));
    },
  });

  /* ---------------------------------------------------------------- view */
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        open={prefs.sidebarOpen}
        config={config}
        onClose={() => updatePrefs({ sidebarOpen: false })}
        onSelect={(id) => {
          setActiveId(id);
          setBanner(undefined);
          updatePrefs({ sidebarOpen: false });
        }}
        onNew={newResearch}
        onDelete={deleteSession}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => updatePrefs({ sidebarOpen: true })}
                className="focus-ring rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
                aria-label="Open history"
              >
                <IconMenu size={18} />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {activeSession ? activeSession.title : 'Deep Research Agent'}
                </p>
                <p className="hidden truncate text-[0.7rem] text-slate-500 dark:text-slate-400 sm:block">
                  {providerLabel}
                  {demoOnly ? ' · offline demo' : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {running ? (
                <Pill tone="indigo" className="hidden sm:inline-flex">
                  researching…
                </Pill>
              ) : null}
              <button
                onClick={() => updatePrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
                className="focus-ring rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Toggle dark mode"
                title="Toggle dark mode"
              >
                {prefs.theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="focus-ring rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Open settings"
                title="Settings"
              >
                <IconSettings size={18} />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {banner ? (
            <div className="mb-4">
              <ErrorBanner
                title={banner.title}
                message={banner.message}
                hint={banner.hint}
                tone={banner.tone}
                onDismiss={() => setBanner(undefined)}
              />
            </div>
          ) : null}

          {rounds.length === 0 ? (
            <div className="mx-auto max-w-2xl pt-4 sm:pt-10">
              <div className="mb-8 text-center">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                  <IconSparkles size={22} />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                  What do you want to research?
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-slate-600 dark:text-slate-400">
                  The agent searches the web, reads full pages, cross-checks claims against independent sources, and
                  returns a cited answer with a confidence level.
                </p>
              </div>

              <QuestionBox
                value={question}
                onChange={setQuestion}
                depth={depth}
                onDepthChange={(d) => {
                  setDepth(d);
                  updatePrefs({ defaultDepth: d });
                }}
                onSubmit={() => startResearch(question)}
                running={running}
                onStop={stopResearch}
                hint="Enter to start · Shift+Enter for a new line"
              />

              {searchKeyMissing && !demoOnly ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  No search API key yet — add one in{' '}
                  <button className="underline" onClick={() => setSettingsOpen(true)}>
                    Settings
                  </button>{' '}
                  (or <code className="font-mono">.env.local</code>) to search the live web. The agent refuses to guess
                  from memory, so research cannot run without it.
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setQuestion(example)}
                    className="focus-ring rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-800 dark:hover:text-indigo-300"
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    icon: <IconSearch size={16} />,
                    title: 'Searches widely',
                    body: 'Multiple keyword angles and sub-questions, preferring official and academic sources.',
                  },
                  {
                    icon: <IconBook size={16} />,
                    title: 'Reads in full',
                    body: 'Opens pages and PDFs, strips ads and menus, and cites only pages it actually read.',
                  },
                  {
                    icon: <IconShield size={16} />,
                    title: 'Cross-checks',
                    body: 'Each load-bearing claim needs two independent sources — conflicts and gaps are reported.',
                  },
                ].map((card) => (
                  <div
                    key={card.title}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-800 dark:bg-slate-900/60"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                      {card.icon}
                    </span>
                    <p className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-white">{card.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{card.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {rounds.map((round, index) => {
                const isLast = index === rounds.length - 1;
                const isRunning = runningRoundId === round.id;
                if (!isLast) {
                  return (
                    <PastRound
                      key={round.id}
                      round={round}
                      actions={reportActionsFor(round)}
                      onFollowUp={(q) => startResearch(q, { followUp: true })}
                    />
                  );
                }
                return (
                  <div key={round.id} className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={round.kind === 'followup' ? 'sky' : 'indigo'}>
                        {round.kind === 'followup' ? 'Follow-up' : 'Research'} · {round.depth}
                      </Pill>
                      {round.status === 'done' ? (
                        <Pill tone="green">
                          <IconCheck size={12} /> complete
                        </Pill>
                      ) : null}
                      {round.status === 'stopped' ? <Pill tone="amber">stopped</Pill> : null}
                      {round.status === 'refused' ? <Pill tone="sky">declined</Pill> : null}
                      {round.status === 'error' ? <Pill tone="rose">failed</Pill> : null}
                      {round.stats ? (
                        <span className="text-xs text-slate-400">{formatDuration(round.stats.elapsedMs)}</span>
                      ) : null}
                    </div>

                    <h2 className="text-lg font-medium leading-snug text-slate-800 dark:text-slate-200">
                      {round.question}
                    </h2>

                    <ProgressView round={round} running={isRunning} onStop={stopResearch} />

                    {round.report ? (
                      <ReportView
                        round={round}
                        report={round.report}
                        actions={reportActionsFor(round)}
                        onFollowUp={(q) => startResearch(q, { followUp: true })}
                      />
                    ) : null}

                    {!isRunning && round.status === 'error' && !round.report ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                        This run ended without a report{round.error ? `: ${round.error.message}` : '.'} Try again with a
                        narrower question, or check Settings.
                      </div>
                    ) : null}

                    {!isRunning && round.status !== 'running' ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-5">
                        <QuestionBox
                          value={question}
                          onChange={setQuestion}
                          depth={depth}
                          onDepthChange={(d) => {
                            setDepth(d);
                            updatePrefs({ defaultDepth: d });
                          }}
                          onSubmit={() => startResearch(question, { followUp: true })}
                          running={running}
                          onStop={stopResearch}
                          variant="inline"
                          placeholder="Ask a follow-up about this research…"
                          hint="Follow-ups reuse the sources already gathered and only research what is new."
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        <footer className="no-print border-t border-slate-200 px-4 py-4 text-center text-[0.7rem] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500 sm:px-6">
          Web pages are treated as untrusted data and the agent will not follow instructions found on them. It refuses
          requests for private personal information or harmful activity. Always verify important findings.
        </footer>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        config={config}
        onClearHistory={clearHistory}
      />

      {toast ? (
        <div className="no-print fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- past rounds */

function PastRound({
  round,
  actions,
  onFollowUp,
}: {
  round: Round;
  actions: ReportActions;
  onFollowUp: (question: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const answer = round.report?.shortAnswer ?? round.error?.message ?? '';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={round.kind === 'followup' ? 'sky' : 'slate'}>
              {round.kind === 'followup' ? 'Follow-up' : 'Research'}
            </Pill>
            {round.status === 'done' ? <Pill tone="green">complete</Pill> : null}
            {round.status === 'refused' ? <Pill tone="sky">declined</Pill> : null}
            {round.status === 'error' ? <Pill tone="rose">failed</Pill> : null}
            {round.status === 'stopped' ? <Pill tone="amber">stopped</Pill> : null}
          </span>
          <span className="mt-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
            {round.question}
          </span>
          {answer && !open ? (
            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {answer}
            </span>
          ) : null}
        </span>
        <IconChevron
          size={16}
          className={`mt-1 shrink-0 text-slate-400 ${open ? 'rotate-180 transition' : 'transition'}`}
        />
      </button>
      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
          <ProgressView round={round} running={false} onStop={() => undefined} />
          {round.report ? (
            <ReportView round={round} report={round.report} actions={actions} onFollowUp={onFollowUp} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

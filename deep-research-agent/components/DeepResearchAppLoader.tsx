'use client';

import dynamic from 'next/dynamic';

/**
 * The app is client-only: it owns localStorage state, an EventSource-style
 * fetch stream and the theme class. Loading it dynamically avoids a
 * server/client hydration mismatch on first paint.
 */
const DeepResearchApp = dynamic(() => import('./DeepResearchApp'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400" />
        Loading Deep Research Agent…
      </div>
    </div>
  ),
});

export default function DeepResearchAppLoader() {
  return <DeepResearchApp />;
}

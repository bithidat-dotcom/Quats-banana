'use client';

import { useEffect, useState } from 'react';
import { testLlmKey, type PublicConfigShape } from '@/lib/client/api';
import type { Prefs } from '@/lib/client/store';
import type { Depth } from '@/lib/types';
import { IconAlert, IconCheck, IconSpinner } from './Icons';
import { Button, Field, Modal, Pill, Switch, inputClass } from './ui';
import { DEPTH_OPTIONS } from './QuestionBox';

export function SettingsModal({
  open,
  onClose,
  prefs,
  onPrefsChange,
  config,
  onClearHistory,
}: {
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  config?: PublicConfigShape;
  onClearHistory: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | undefined>();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) {
      setTestResult(undefined);
      setConfirmClear(false);
    }
  }, [open]);

  const provider = prefs.llmProvider || config?.llm.defaultProvider || 'gemini';
  const catalogEntry = config?.llm.catalog.find((p) => p.id === provider);
  const needsBaseUrl = provider === 'openai-compatible' || !!catalogEntry?.needsBaseUrl;
  const keyOnServer = !!config?.llm.available[provider];

  const runTest = async () => {
    setTesting(true);
    setTestResult(undefined);
    const result = await testLlmKey({
      provider,
      model: prefs.llmModel || catalogEntry?.defaultModel,
      apiKey: prefs.llmKey || undefined,
      baseUrl: prefs.llmBaseUrl || undefined,
    });
    setTestResult({ ok: result.ok, message: result.message });
    setTesting(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        {/* ------------------------------------------------------- model */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Language model</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            The agent&apos;s reasoning model. Keys typed here are sent only to this server (never stored in the page bundle or
            sent anywhere else).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Provider" htmlFor="provider">
              <select
                id="provider"
                className={inputClass}
                value={provider}
                onChange={(e) => {
                  const next = e.target.value;
                  const entry = config?.llm.catalog.find((p) => p.id === next);
                  onPrefsChange({ llmProvider: next, llmModel: entry?.defaultModel ?? '' });
                  setTestResult(undefined);
                }}
              >
                {(config?.llm.catalog ?? [{ id: 'gemini', label: 'Google Gemini', envKeys: [], defaultModel: '', suggestedModels: [] }]).map(
                  (p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {config?.llm.available[p.id] ? ' — ready' : ''}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field
              label="Model"
              htmlFor="model"
              hint={catalogEntry?.suggestedModels.length ? `Suggestions: ${catalogEntry.suggestedModels.join(', ')}` : undefined}
            >
              <input
                id="model"
                list="model-suggestions"
                className={inputClass}
                value={prefs.llmModel}
                placeholder={catalogEntry?.defaultModel || 'model name'}
                onChange={(e) => onPrefsChange({ llmModel: e.target.value })}
              />
              <datalist id="model-suggestions">
                {(catalogEntry?.suggestedModels ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>

            {needsBaseUrl ? (
              <Field
                label="Base URL"
                htmlFor="baseurl"
                hint="For OpenAI-compatible gateways (Groq, Together, vLLM, Ollama…). Must end in /v1."
              >
                <input
                  id="baseurl"
                  className={inputClass}
                  value={prefs.llmBaseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => onPrefsChange({ llmBaseUrl: e.target.value })}
                />
              </Field>
            ) : null}

            <Field
              label="API key"
              htmlFor="llmkey"
              hint={
                keyOnServer
                  ? 'A key is already configured for this provider in .env.local — leave empty to use it.'
                  : `Or set ${catalogEntry?.envKeys.join(' / ') || 'the env var'} in .env.local and restart.`
              }
            >
              <input
                id="llmkey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
                value={prefs.llmKey}
                placeholder={keyOnServer ? '•••••••• (from server env)' : 'paste key'}
                onChange={(e) => onPrefsChange({ llmKey: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={runTest} loading={testing}>
              {testing ? <IconSpinner size={14} /> : null} Test connection
            </Button>
            {keyOnServer ? (
              <Pill tone="green">
                <IconCheck size={12} /> server key present
              </Pill>
            ) : (
              <Pill tone="amber">
                <IconAlert size={12} /> no server key
              </Pill>
            )}
          </div>
          {testResult ? (
            <p
              className={`mt-2 rounded-xl px-3 py-2 text-xs ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
              }`}
            >
              {testResult.message}
            </p>
          ) : null}
        </section>

        {/* ------------------------------------------------------ search */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Web search</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Used by the agent&apos;s <code className="font-mono text-[0.7rem]">web_search</code> tool. Tavily, Brave and Serper are
            supported.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Provider" htmlFor="searchprovider">
              <select
                id="searchprovider"
                className={inputClass}
                value={prefs.searchProvider}
                onChange={(e) => onPrefsChange({ searchProvider: e.target.value })}
              >
                <option value="auto">Auto (best configured)</option>
                {(config?.search.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {config?.search.available[o.id] ? ' — ready' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Search API key"
              htmlFor="searchkey"
              hint={
                config?.search.serverKeyConfigured
                  ? 'A search key is already configured on the server.'
                  : 'Or set TAVILY_API_KEY / BRAVE_SEARCH_API_KEY / SERPER_API_KEY in .env.local.'
              }
            >
              <input
                id="searchkey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
                value={prefs.searchKey}
                placeholder={config?.search.serverKeyConfigured ? '•••••••• (from server env)' : 'paste key'}
                onChange={(e) => onPrefsChange({ searchKey: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {config
              ? config.search.options.map((o) => (
                  <Pill key={o.id} tone={config.search.available[o.id] ? 'green' : 'slate'}>
                    {o.label.split(' ')[0]}: {config.search.available[o.id] ? 'ready' : 'no key'}
                  </Pill>
                ))
              : null}
          </div>
        </section>

        {/* -------------------------------------------------- preferences */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Preferences</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Default depth" htmlFor="depth">
              <select
                id="depth"
                className={inputClass}
                value={prefs.defaultDepth}
                onChange={(e) => onPrefsChange({ defaultDepth: e.target.value as Depth })}
              >
                {DEPTH_OPTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} — {d.blurb}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Appearance" htmlFor="theme">
              <select
                id="theme"
                className={inputClass}
                value={prefs.theme}
                onChange={(e) => onPrefsChange({ theme: e.target.value as Prefs['theme'] })}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>
          </div>
          <div className="mt-3">
            <Switch
              checked={prefs.showDetails}
              onChange={(v) => onPrefsChange({ showDetails: v })}
              label="Show agent activity (searches and pages) expanded by default"
            />
          </div>
        </section>

        {/* --------------------------------------------------------- data */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Data</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            History and preferences live in this browser&apos;s localStorage. API keys are never written to disk by the app.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {confirmClear ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onClearHistory();
                    setConfirmClear(false);
                  }}
                >
                  Yes, delete all history
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)}>
                Clear research history
              </Button>
            )}
          </div>
        </section>

        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
          Prefer environment variables for keys: copy <code className="font-mono">.env.example</code> to{' '}
          <code className="font-mono">.env.local</code>, fill in your keys, restart the dev server, and leave the key fields above
          empty. Nothing in this UI is ever bundled into client JavaScript.
        </p>
      </div>
    </Modal>
  );
}

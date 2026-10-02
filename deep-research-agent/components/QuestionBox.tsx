'use client';

import { useEffect, useRef } from 'react';
import type { Depth } from '@/lib/types';
import { IconSearch, IconSpinner, IconStop } from './Icons';
import { Button } from './ui';

const DEPTHS: { id: Depth; label: string; blurb: string }[] = [
  { id: 'quick', label: 'Quick', blurb: '3–5 searches · fastest' },
  { id: 'standard', label: 'Standard', blurb: '8–12 searches · balanced' },
  { id: 'deep', label: 'Deep', blurb: '15–25 searches · thorough' },
];

export function DepthSelector({
  depth,
  onChange,
  disabled,
  compact = false,
}: {
  depth: Depth;
  onChange: (depth: Depth) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Research depth"
      className={`inline-flex rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800 ${disabled ? 'opacity-60' : ''}`}
    >
      {DEPTHS.map((option) => {
        const active = depth === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            title={option.blurb}
            className={`focus-ring rounded-[0.6rem] px-3 py-1.5 text-[0.8125rem] font-medium transition ${
              active
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
            } ${compact ? 'px-2.5' : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionBox({
  value,
  onChange,
  depth,
  onDepthChange,
  onSubmit,
  running,
  onStop,
  variant = 'hero',
  placeholder = 'What do you want to research?',
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  depth: Depth;
  onDepthChange: (depth: Depth) => void;
  onSubmit: () => void;
  running: boolean;
  onStop: () => void;
  variant?: 'hero' | 'inline';
  placeholder?: string;
  hint?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a sensible maximum.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, variant === 'hero' ? 220 : 180)}px`;
  }, [value, variant]);

  const submit = () => {
    if (running || value.trim().length < 3) return;
    onSubmit();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={variant === 'hero' ? 'w-full' : 'w-full'}>
      <div
        className={`group relative rounded-2xl border bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:bg-slate-900 ${
          variant === 'hero' ? 'border-slate-200 p-2 dark:border-slate-700' : 'border-slate-200 p-1.5 dark:border-slate-700'
        }`}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={variant === 'hero' ? 3 : 1}
          disabled={running}
          aria-label="Research question"
          className={`w-full resize-none bg-transparent px-3 pb-2 pt-3 text-slate-900 placeholder-slate-400 outline-none disabled:opacity-60 dark:text-slate-100 dark:placeholder-slate-500 ${
            variant === 'hero' ? 'min-h-[5.5rem] text-[1.0625rem] leading-7' : 'min-h-[3rem] text-[0.9375rem] leading-6'
          }`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
          <DepthSelector depth={depth} onChange={onDepthChange} disabled={running} compact={variant === 'inline'} />
          {running ? (
            <Button variant="danger" onClick={onStop} className="shrink-0">
              <IconStop size={16} /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={submit} disabled={value.trim().length < 3} className="shrink-0">
              <IconSearch size={16} /> Research
            </Button>
          )}
        </div>
        {running ? (
          <span className="pointer-events-none absolute right-3 top-3 text-indigo-500">
            <IconSpinner size={16} />
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

export const DEPTH_OPTIONS = DEPTHS;

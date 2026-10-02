'use client';

import type { Depth, Session } from '@/lib/types';

export const SESSIONS_KEY = 'dr.sessions.v3';
export const PREFS_KEY = 'dr.prefs.v3';
export const THEME_KEY = 'dr.theme';

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  llmProvider: string;
  llmModel: string;
  llmBaseUrl: string;
  llmKey: string;
  searchProvider: string;
  searchKey: string;
  defaultDepth: Depth;
  /** Expand the "all searches and pages" list by default. */
  showDetails: boolean;
  sidebarOpen: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  llmProvider: '',
  llmModel: '',
  llmBaseUrl: '',
  llmKey: '',
  searchProvider: 'auto',
  searchKey: '',
  defaultDepth: 'standard',
  showDetails: false,
  sidebarOpen: false,
};

const MAX_SESSIONS = 25;
const MAX_ROUNDS = 12;
const MAX_EVIDENCE_WITH_TEXT = 8;
const MAX_TEXT_CHARS = 6000;

/** Trim a session so localStorage stays small and writing never throws. */
export function trimSession(session: Session): Session {
  return {
    ...session,
    rounds: session.rounds.slice(-MAX_ROUNDS).map((round) => ({
      ...round,
      streamingReport: undefined,
      evidence: round.evidence?.slice(0, 40).map((e, i) => ({
        ...e,
        text: i < MAX_EVIDENCE_WITH_TEXT && e.text ? e.text.slice(0, MAX_TEXT_CHARS) : undefined,
      })),
      timeline: round.timeline.slice(-120),
    })),
  };
}

export function loadSessions(): Session[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.rounds))
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]): void {
  if (typeof window === 'undefined') return;
  const payload = sessions.slice(0, MAX_SESSIONS).map(trimSession);
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(payload));
  } catch {
    // Storage full: drop the oldest half and try once more.
    try {
      window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(payload.slice(0, Math.ceil(payload.length / 2))));
    } catch {
      /* give up silently — history is a convenience, not critical data */
    }
  }
}

export function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: Prefs['theme']): void {
  if (typeof window === 'undefined') return;
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function newId(prefix = 's'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function createSession(depth: Depth, provider: string, model: string, title: string): Session {
  const now = Date.now();
  return {
    id: newId(),
    title: title.slice(0, 90) || 'New research',
    createdAt: now,
    updatedAt: now,
    depth,
    provider,
    model,
    rounds: [],
  };
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

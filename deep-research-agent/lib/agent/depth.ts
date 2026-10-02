import type { Depth } from '@/lib/types';

export interface DepthConfig {
  id: Depth;
  label: string;
  blurb: string;
  /** Soft target the planner is told to aim for. */
  minSearches: number;
  maxSearches: number;
  minPages: number;
  maxPages: number;
  maxSteps: number;
  /** Max wall-clock time for a run. */
  timeoutMs: number;
  resultsPerSearch: number;
  /** Characters of each fetched page handed to the model. */
  maxCharsPerPage: number;
  /** Verification turns allowed after the research turns. */
  verifySteps: number;
  /** Items + chars used to build the writer's evidence digest. */
  writerEvidenceItems: number;
  writerCharsPerItem: number;
  maxTokensPerStep: number;
}

const BASE: Record<Depth, DepthConfig> = {
  quick: {
    id: 'quick',
    label: 'Quick',
    blurb: '3–5 searches · fastest',
    minSearches: 3,
    maxSearches: 5,
    minPages: 2,
    maxPages: 6,
    maxSteps: 14,
    timeoutMs: 4 * 60 * 1000,
    resultsPerSearch: 5,
    maxCharsPerPage: 6_000,
    verifySteps: 2,
    writerEvidenceItems: 10,
    writerCharsPerItem: 1_600,
    maxTokensPerStep: 2_048,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    blurb: '8–12 searches · balanced',
    minSearches: 8,
    maxSearches: 12,
    minPages: 5,
    maxPages: 15,
    maxSteps: 34,
    timeoutMs: 9 * 60 * 1000,
    resultsPerSearch: 5,
    maxCharsPerPage: 8_000,
    verifySteps: 4,
    writerEvidenceItems: 18,
    writerCharsPerItem: 1_800,
    maxTokensPerStep: 2_048,
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    blurb: '15–25 searches · most thorough',
    minSearches: 15,
    maxSearches: 25,
    minPages: 10,
    maxPages: 30,
    maxSteps: 70,
    timeoutMs: 20 * 60 * 1000,
    resultsPerSearch: 6,
    maxCharsPerPage: 10_000,
    verifySteps: 6,
    writerEvidenceItems: 26,
    writerCharsPerItem: 2_000,
    maxTokensPerStep: 2_048,
  },
};

export const DEPTHS: DepthConfig[] = [BASE.quick, BASE.standard, BASE.deep];

export function depthConfig(depth: Depth): DepthConfig {
  const cfg = BASE[depth] ?? BASE.standard;
  const multiplier = Number(process.env.DR_MAX_STEPS_MULTIPLIER ?? 1);
  if (!Number.isFinite(multiplier) || multiplier === 1) return cfg;
  const scale = (n: number) => Math.max(1, Math.round(n * multiplier));
  return {
    ...cfg,
    maxSearches: scale(cfg.maxSearches),
    maxPages: scale(cfg.maxPages),
    maxSteps: scale(cfg.maxSteps),
    verifySteps: scale(cfg.verifySteps),
  };
}

export function isDepth(value: unknown): value is Depth {
  return value === 'quick' || value === 'standard' || value === 'deep';
}

export function defaultDepth(): Depth {
  const d = process.env.DR_DEFAULT_DEPTH;
  return isDepth(d) ? d : 'standard';
}

/**
 * Types shared between the server (agent) and the browser (UI).
 * Keep this file free of Node-only imports.
 */

export type Depth = 'quick' | 'standard' | 'deep';

export type Phase =
  | 'queued'
  | 'planning'
  | 'searching'
  | 'reading'
  | 'verifying'
  | 'writing'
  | 'done'
  | 'error';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  provider: string;
  rank?: number;
}

export interface EvidenceItem {
  /** Stable id used in citations, e.g. [3]. Assigned on first insert, never changes. */
  n: number;
  url: string;
  title: string;
  domain: string;
  publishedDate?: string;
  snippet?: string;
  /** Clean readable text of the page (capped). Present only after a successful fetch. */
  text?: string;
  textChars?: number;
  fetched: boolean;
  truncated?: boolean;
  origin: 'search' | 'fetch' | 'prior';
  query?: string;
}

export interface Plan {
  restatedQuestion: string;
  understanding: string;
  subQuestions: string[];
  searchQueries: string[];
  keyClaims: string[];
  safe: boolean;
  safetyNote?: string;
  followUp?: boolean;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ReportSource {
  n: number;
  title: string;
  url: string;
  domain: string;
  date?: string;
  type?: string;
  supports: string;
  quote?: string;
}

export interface ReportFinding {
  heading: string;
  bullets: string[];
}

export interface Report {
  title: string;
  question: string;
  shortAnswer: string;
  confidence: Confidence;
  confidenceReason: string;
  findings: ReportFinding[];
  sources: ReportSource[];
  conflicts: string[];
  uncertainties: string[];
  followUpQuestions: string[];
  methodology?: string;
  generatedAt: string;
  /** True when the model's JSON could not be parsed and we fell back to raw text. */
  degraded?: boolean;
  /** Notes about citations/quotes that were dropped because they could not be verified. */
  integrityNotes?: string[];
}

export interface RunStats {
  steps: number;
  searches: number;
  pagesRead: number;
  pagesFailed: number;
  evidence: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | {
      type: 'session';
      sessionId: string;
      startedAt: number;
      depth: Depth;
      provider: string;
      model: string;
      mode: 'research' | 'followup';
    }
  | { type: 'status'; phase: Phase; message: string; detail?: string }
  | { type: 'plan'; plan: Plan }
  | {
      type: 'search';
      query: string;
      provider: string;
      count: number;
      ms?: number;
      error?: string;
      results: {
        title: string;
        url: string;
        domain: string;
        snippet?: string;
        date?: string;
      }[];
    }
  | {
      type: 'read';
      url: string;
      title?: string;
      status: 'start' | 'ok' | 'error';
      chars?: number;
      date?: string;
      error?: string;
      ms?: number;
      truncated?: boolean;
    }
  | { type: 'verify'; text: string }
  | { type: 'note'; message: string }
  | { type: 'report_delta'; text: string }
  | { type: 'report'; report: Report; evidence: EvidenceItem[] }
  | { type: 'stats'; stats: RunStats }
  | { type: 'error'; code: string; message: string; hint?: string; detail?: string }
  | { type: 'done'; reason: 'complete' | 'stopped' | 'timeout' | 'error' | 'refused' };

export type TimelineItem =
  | { id: string; kind: 'status'; at: number; message: string; phase: Phase; detail?: string }
  | {
      id: string;
      kind: 'search';
      at: number;
      query: string;
      provider: string;
      count: number;
      ms?: number;
      error?: string;
      results: { title: string; url: string; domain: string; snippet?: string; date?: string }[];
    }
  | {
      id: string;
      kind: 'read';
      at: number;
      url: string;
      title?: string;
      status: 'start' | 'ok' | 'error';
      chars?: number;
      date?: string;
      error?: string;
      ms?: number;
      truncated?: boolean;
    }
  | { id: string; kind: 'verify'; at: number; text: string }
  | { id: string; kind: 'note'; at: number; message: string };

export interface Round {
  id: string;
  question: string;
  depth: Depth;
  kind: 'research' | 'followup';
  status: 'running' | 'done' | 'error' | 'stopped' | 'refused';
  startedAt: number;
  finishedAt?: number;
  timeline: TimelineItem[];
  /** The plan the agent agreed on, when one was produced. */
  plan?: Plan;
  /** Appended live while the report is being written. */
  streamingReport?: string;
  report?: Report;
  evidence?: EvidenceItem[];
  stats?: RunStats;
  error?: { code: string; message: string; hint?: string };
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  depth: Depth;
  provider: string;
  model: string;
  rounds: Round[];
}

export interface LlmProviderOption {
  id: string;
  label: string;
  envKeys: string[];
  defaultModel: string;
  suggestedModels: string[];
  needsBaseUrl?: boolean;
}

export interface SearchProviderOption {
  id: string;
  label: string;
  envKeys: string[];
  signupUrl: string;
}

/** Error codes shared by the server and the UI copy. */
export type ErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'QUOTA'
  | 'NO_RESULTS'
  | 'PAGE_BLOCKED'
  | 'PAGE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'REFUSED'
  | 'BLOCKED_ADDRESS'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

export interface FriendlyError {
  code: ErrorCode;
  message: string;
  hint?: string;
  status: number;
}

export class AppError extends Error {
  code: ErrorCode;
  hint?: string;
  status: number;
  retryable: boolean;
  detail?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { hint?: string; status?: number; retryable?: boolean; detail?: string } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = opts.hint;
    this.status = opts.status ?? 500;
    this.retryable = opts.retryable ?? false;
    this.detail = opts.detail;
  }
}

const HINTS: Partial<Record<ErrorCode, string>> = {
  MISSING_KEY:
    'Add the key in Settings, or put it in .env.local and restart the server.',
  INVALID_KEY:
    'Double-check the key (it may be expired or belong to another project). You can test it from Settings.',
  RATE_LIMIT: 'Wait a minute and try again, or switch to a different provider/key.',
  QUOTA: 'Your provider account has run out of credit or quota.',
  NO_RESULTS:
    'Try a broader phrasing or a different search provider.',
  PAGE_BLOCKED:
    'This site blocks automated readers. The agent skips it and looks for another source.',
  PAGE_TOO_LARGE: 'The page was bigger than the download limit and was skipped.',
  UNSUPPORTED_TYPE: 'Only HTML, text and PDF pages can be read.',
  TIMEOUT: 'The run hit its time limit. Try Quick or Standard depth, or ask a narrower question.',
  NETWORK: 'Check your internet connection and try again.',
  MODEL_NOT_FOUND: 'Pick a different model in Settings.',
  REFUSED: 'This kind of request is outside what the agent will help with.',
  BLOCKED_ADDRESS: 'Requests to private/internal addresses are blocked for security.',
};

const LABELS: Partial<Record<ErrorCode, string>> = {
  MISSING_KEY: 'Missing API key',
  INVALID_KEY: 'API key rejected',
  RATE_LIMIT: 'Rate limit reached',
  QUOTA: 'Quota exhausted',
  NO_RESULTS: 'No results',
  PAGE_BLOCKED: 'Page blocked',
  PAGE_TOO_LARGE: 'Page too large',
  UNSUPPORTED_TYPE: 'Unsupported file type',
  TIMEOUT: 'Timed out',
  NETWORK: 'Network problem',
  BAD_REQUEST: 'Bad request',
  NOT_FOUND: 'Not found',
  MODEL_NOT_FOUND: 'Model unavailable',
  REFUSED: 'Request declined',
  BLOCKED_ADDRESS: 'Blocked address',
  PROVIDER_ERROR: 'Provider error',
  INTERNAL: 'Something went wrong',
};

/** Convert any thrown value into something safe we can show a human. */
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      hint: err.hint ?? HINTS[err.code],
      status: err.status,
    };
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return { code: 'TIMEOUT', message: 'The request was aborted.', hint: HINTS.TIMEOUT, status: 499 };
    }
    const m = err.message || 'Unexpected error';
    return { code: 'INTERNAL', message: m, hint: HINTS.INTERNAL, status: 500 };
  }
  return { code: 'INTERNAL', message: 'Unexpected error', hint: HINTS.INTERNAL, status: 500 };
}

export function labelForCode(code: ErrorCode): string {
  return LABELS[code] ?? 'Something went wrong';
}

export function hintForCode(code: ErrorCode): string | undefined {
  return HINTS[code];
}

/** Map an HTTP status from an LLM/search provider to one of our codes. */
export function mapHttpStatus(status: number, bodyText: string): AppError {
  const body = bodyText.slice(0, 600);
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) {
    return new AppError('INVALID_KEY', 'The provider rejected the API key.', {
      status,
      detail: body,
    });
  }
  if (status === 404) {
    if (lower.includes('model')) {
      return new AppError('MODEL_NOT_FOUND', 'That model does not exist for this key.', {
        status,
        detail: body,
      });
    }
    return new AppError('NOT_FOUND', 'The provider could not find that resource.', { status, detail: body });
  }
  if (status === 429) {
    return new AppError('RATE_LIMIT', 'The provider rate limit was hit.', {
      status,
      retryable: true,
      detail: body,
    });
  }
  if (status === 402) {
    return new AppError('QUOTA', 'The provider reports no remaining credit.', { status, detail: body });
  }
  if (status >= 500) {
    return new AppError('PROVIDER_ERROR', `The provider returned an error (${status}).`, {
      status,
      retryable: true,
      detail: body,
    });
  }
  return new AppError('PROVIDER_ERROR', `The provider returned an error (${status}).`, {
    status,
    detail: body,
  });
}

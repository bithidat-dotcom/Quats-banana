import { runResearch } from '@/lib/agent/agent';
import { isDepth } from '@/lib/agent/depth';
import { assertBodySize, clientKey, credentialsFromRequest, rateLimitConfigFromEnv } from '@/lib/config';
import { AppError, friendlyError, labelForCode } from '@/lib/errors';
import { checkRateLimit, releaseSlot } from '@/lib/rate-limit';
import type { Depth, EvidenceItem, Report, StreamEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const MAX_QUESTION = 2000;
const MAX_PRIOR_EVIDENCE = 25;
const MAX_PRIOR_TEXT = 12_000;

export async function POST(req: Request) {
  try {
    assertBodySize(req);

    const ipKey = clientKey(req);
    const limiter = checkRateLimit(ipKey, rateLimitConfigFromEnv());
    if (!limiter.ok) {
      const message =
        limiter.reason === 'concurrent'
          ? `You already have ${limiter.limit} research runs in progress. Wait for one to finish or stop it.`
          : `Rate limit reached: ${limiter.limit} researches per ${Math.round(limiter.windowSec / 60)} minutes.`;
      return sseError({
        code: 'RATE_LIMIT',
        message,
        hint: `Try again in about ${limiter.retryAfterSec}s.`,
        status: 429,
      });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      releaseSlot(ipKey);
      throw new AppError('BAD_REQUEST', 'The request body must be JSON.', { status: 400 });
    }

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (question.length < 3) {
      releaseSlot(ipKey);
      return sseError({
        code: 'BAD_REQUEST',
        message: 'Please type a question with at least 3 characters.',
        status: 400,
      });
    }
    if (question.length > MAX_QUESTION) {
      releaseSlot(ipKey);
      return sseError({ code: 'BAD_REQUEST', message: 'That question is too long (2000 characters max).', status: 400 });
    }

    const depth: Depth = isDepth(body.depth) ? body.depth : 'standard';
    const sessionId =
      typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.sessionId)
        ? body.sessionId
        : `s_${Date.now().toString(36)}`;

    const creds = credentialsFromRequest(req, body);
    const prior = sanitizePrior(body.prior);
    const controller = new AbortController();
    req.signal.addEventListener('abort', () => controller.abort(), { once: true });

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controllerStream) {
        const send = (event: StreamEvent) => {
          if (closed) return;
          try {
            controllerStream.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };

        // Keep proxies from closing an idle connection while the model thinks.
        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controllerStream.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            closed = true;
          }
        }, 20_000);

        const finish = () => {
          clearInterval(heartbeat);
          releaseSlot(ipKey);
          closed = true;
          try {
            controllerStream.close();
          } catch {
            /* already closed */
          }
        };

        runResearch({
          sessionId,
          question,
          depth,
          mode: prior ? 'followup' : 'research',
          llm: creds.llm,
          search: creds.search,
          prior,
          signal: controller.signal,
          emit: send,
        })
          .catch((err) => {
            const f = friendlyError(err);
            send({ type: 'error', code: f.code, message: f.message, hint: f.hint });
            send({ type: 'done', reason: 'error' });
          })
          .finally(finish);
      },
      cancel() {
        closed = true;
        releaseSlot(ipKey);
        controller.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    const f = friendlyError(err);
    return Response.json(
      { error: { code: f.code, label: labelForCode(f.code), message: f.message, hint: f.hint } },
      { status: f.status || 500 },
    );
  }
}

/** Streaming-agnostic JSON error, so the client can show friendly copy. */
function sseError(args: { code: string; message: string; hint?: string; status: number }) {
  return Response.json(
    { error: { code: args.code, label: labelForCode(args.code as never), message: args.message, hint: args.hint } },
    { status: args.status },
  );
}

function sanitizePrior(raw: unknown): { question: string; report: Report; evidence: EvidenceItem[] } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as { report?: unknown; evidence?: unknown };
  const report = obj.report as Report | undefined;
  if (!report || typeof report !== 'object' || typeof report.shortAnswer !== 'string') return undefined;

  const evidence: EvidenceItem[] = Array.isArray(obj.evidence)
    ? (obj.evidence as EvidenceItem[])
        .filter((e) => e && typeof e.url === 'string' && typeof e.n === 'number')
        .slice(0, MAX_PRIOR_EVIDENCE)
        .map((e) => ({
          n: e.n,
          url: e.url.slice(0, 2000),
          title: String(e.title ?? '').slice(0, 300),
          domain: String(e.domain ?? '').slice(0, 200),
          publishedDate: e.publishedDate ? String(e.publishedDate).slice(0, 32) : undefined,
          snippet: e.snippet ? String(e.snippet).slice(0, 500) : undefined,
          text: e.fetched && e.text ? String(e.text).slice(0, MAX_PRIOR_TEXT) : undefined,
          textChars: e.textChars,
          fetched: !!e.fetched,
          origin: 'prior' as const,
        }))
    : [];

  return {
    question: String(report.question ?? '').slice(0, MAX_QUESTION),
    report: {
      ...report,
      title: String(report.title ?? '').slice(0, 300),
      question: String(report.question ?? '').slice(0, MAX_QUESTION),
      shortAnswer: String(report.shortAnswer).slice(0, 4000),
      confidenceReason: String(report.confidenceReason ?? '').slice(0, 600),
      findings: Array.isArray(report.findings)
        ? report.findings.slice(0, 20).map((f) => ({
            heading: String(f?.heading ?? '').slice(0, 200),
            bullets: (Array.isArray(f?.bullets) ? f.bullets : []).slice(0, 15).map((b) => String(b).slice(0, 900)),
          }))
        : [],
      sources: Array.isArray(report.sources)
        ? report.sources.slice(0, 30).map((s) => ({
            n: Number(s?.n ?? 0),
            title: String(s?.title ?? '').slice(0, 300),
            url: String(s?.url ?? '').slice(0, 2000),
            domain: String(s?.domain ?? '').slice(0, 200),
            date: s?.date ? String(s.date).slice(0, 32) : undefined,
            type: s?.type ? String(s.type).slice(0, 40) : undefined,
            supports: String(s?.supports ?? '').slice(0, 400),
            quote: s?.quote ? String(s.quote).slice(0, 600) : undefined,
          }))
        : [],
      conflicts: Array.isArray(report.conflicts) ? report.conflicts.slice(0, 15).map((c) => String(c).slice(0, 700)) : [],
      uncertainties: Array.isArray(report.uncertainties)
        ? report.uncertainties.slice(0, 15).map((c) => String(c).slice(0, 700))
        : [],
      followUpQuestions: [],
      generatedAt: String(report.generatedAt ?? new Date().toISOString()),
    },
    evidence,
  };
}

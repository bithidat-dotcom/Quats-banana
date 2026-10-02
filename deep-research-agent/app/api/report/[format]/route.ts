import { AppError, friendlyError } from '@/lib/errors';
import { reportToMarkdown, reportToPlainText } from '@/lib/report/markdown';
import { pdfFilename, reportToPdf } from '@/lib/report/pdf';
import type { Report } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Renders a report the browser already holds as a downloadable file.
 * Supported formats: md | pdf | txt
 */
export async function POST(req: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    const { format } = await ctx.params;
    if (!['md', 'pdf', 'txt'].includes(format)) {
      throw new AppError('BAD_REQUEST', `Unsupported format "${format}". Use md, pdf or txt.`, { status: 400 });
    }

    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > 1_500_000) throw new AppError('BAD_REQUEST', 'That report is too large to render.', { status: 413 });

    const body = (await req.json().catch(() => null)) as { report?: Report } | null;
    const report = body?.report;
    if (!report || typeof report !== 'object' || typeof report.shortAnswer !== 'string') {
      throw new AppError('BAD_REQUEST', 'No report was supplied.', { status: 400 });
    }

    const safe: Report = {
      ...report,
      title: String(report.title ?? 'Deep research report').slice(0, 300),
      question: String(report.question ?? '').slice(0, 2000),
      shortAnswer: String(report.shortAnswer).slice(0, 6000),
      confidenceReason: String(report.confidenceReason ?? '').slice(0, 800),
      findings: Array.isArray(report.findings)
        ? report.findings.slice(0, 30).map((f) => ({
            heading: String(f?.heading ?? '').slice(0, 200),
            bullets: (Array.isArray(f?.bullets) ? f.bullets : []).slice(0, 20).map((b) => String(b).slice(0, 1000)),
          }))
        : [],
      sources: Array.isArray(report.sources)
        ? report.sources.slice(0, 60).map((s) => ({
            n: Number(s?.n ?? 0),
            title: String(s?.title ?? '').slice(0, 300),
            url: String(s?.url ?? '').slice(0, 2000),
            domain: String(s?.domain ?? '').slice(0, 200),
            date: s?.date ? String(s.date).slice(0, 32) : undefined,
            type: s?.type ? String(s.type).slice(0, 40) : undefined,
            supports: String(s?.supports ?? '').slice(0, 500),
            quote: s?.quote ? String(s.quote).slice(0, 800) : undefined,
          }))
        : [],
      conflicts: (report.conflicts ?? []).slice(0, 20).map((c) => String(c).slice(0, 800)),
      uncertainties: (report.uncertainties ?? []).slice(0, 20).map((c) => String(c).slice(0, 800)),
      integrityNotes: (report.integrityNotes ?? []).slice(0, 20).map((c) => String(c).slice(0, 500)),
      followUpQuestions: (report.followUpQuestions ?? []).slice(0, 10).map((c) => String(c).slice(0, 300)),
      methodology: report.methodology ? String(report.methodology).slice(0, 600) : undefined,
      generatedAt: String(report.generatedAt ?? new Date().toISOString()),
      degraded: !!report.degraded,
    };

    if (format === 'md') {
      const md = reportToMarkdown(safe);
      return new Response(md, {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="${filenameFor(safe.title, 'md')}"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (format === 'txt') {
      const txt = reportToPlainText(safe);
      return new Response(txt, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="${filenameFor(safe.title, 'txt')}"`,
          'cache-control': 'no-store',
        },
      });
    }

    const pdf = await reportToPdf(safe);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${pdfFilename(safe.title)}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const f = friendlyError(err);
    return Response.json(
      { error: { code: f.code, message: f.message, hint: f.hint } },
      { status: f.status || 500 },
    );
  }
}

function filenameFor(title: string, ext: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'deep-research-report';
  return `${slug}.${ext}`;
}

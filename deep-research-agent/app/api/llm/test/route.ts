import { assertBodySize, clientKey, credentialsFromRequest, rateLimitConfigFromEnv } from '@/lib/config';
import { friendlyError, labelForCode } from '@/lib/errors';
import { testLlmKey } from '@/lib/llm';
import { checkRateLimit, releaseSlot } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Settings → "Test key": one tiny completion to prove the credentials work. */
export async function POST(req: Request) {
  const ipKey = clientKey(req);
  const limiter = checkRateLimit(ipKey, { ...rateLimitConfigFromEnv(), maxConcurrent: 3, windowMs: 300_000, max: 20 });
  if (!limiter.ok) {
    return Response.json(
      { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many key tests. Wait a moment and try again.' } },
      { status: 429 },
    );
  }

  try {
    assertBodySize(req, 20_000);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const creds = credentialsFromRequest(req, body);
    const result = await testLlmKey({
      provider: creds.llm.provider,
      model: creds.llm.model,
      apiKey: creds.llm.apiKey,
      baseUrl: creds.llm.baseUrl,
    });
    return Response.json(
      { ok: true, label: result.label, message: result.message },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const f = friendlyError(err);
    return Response.json(
      {
        ok: false,
        error: { code: f.code, label: labelForCode(f.code), message: f.message, hint: f.hint },
      },
      { status: f.status && f.status >= 400 ? f.status : 400 },
    );
  } finally {
    releaseSlot(ipKey);
  }
}

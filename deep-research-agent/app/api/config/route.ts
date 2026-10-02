import { NextResponse } from 'next/server';
import { getPublicConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, secret-free configuration: which providers are usable on this
 * server, default model/depth, and rate-limit hints. API keys never appear
 * here — the browser only ever learns whether a key is present.
 */
export async function GET() {
  return NextResponse.json(getPublicConfig(), {
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Minimal in-process rate limiter.
 *
 * NOTE: state lives in the Node process, so it protects a single instance
 * (fine for local use / a single container). Put a shared store (Redis,
 * Upstash) behind `checkRateLimit` if you deploy many instances.
 */

interface Bucket {
  /** Timestamps of accepted requests inside the current window. */
  hits: number[];
  /** Requests currently in flight. */
  active: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

function getBucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) {
      // Crude eviction: drop the oldest quarter of keys.
      const entries = [...buckets.entries()].sort((a, z) => a[1].updatedAt - z[1].updatedAt);
      for (let i = 0; i < entries.length / 4; i++) buckets.delete(entries[i][0]);
    }
    b = { hits: [], active: 0, updatedAt: Date.now() };
    buckets.set(key, b);
  }
  return b;
}

export interface RateLimitConfig {
  max: number;
  windowMs: number;
  maxConcurrent: number;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'rate' | 'concurrent'; retryAfterSec: number; limit: number; windowSec: number };

export function checkRateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const b = getBucket(key);
  b.updatedAt = now;
  b.hits = b.hits.filter((t) => now - t < cfg.windowMs);

  if (b.hits.length >= cfg.max) {
    const oldest = b.hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((cfg.windowMs - (now - oldest)) / 1000));
    return { ok: false, reason: 'rate', retryAfterSec, limit: cfg.max, windowSec: Math.round(cfg.windowMs / 1000) };
  }
  if (b.active >= cfg.maxConcurrent) {
    return { ok: false, reason: 'concurrent', retryAfterSec: 20, limit: cfg.maxConcurrent, windowSec: 0 };
  }
  b.hits.push(now);
  b.active += 1;
  return { ok: true };
}

export function releaseSlot(key: string): void {
  const b = buckets.get(key);
  if (b && b.active > 0) b.active -= 1;
}

export function rateLimitConfigFromEnv(): RateLimitConfig {
  const int = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    max: int(process.env.DR_RATE_LIMIT_MAX, 12),
    windowMs: int(process.env.DR_RATE_WINDOW_MS, 10 * 60 * 1000),
    maxConcurrent: int(process.env.DR_MAX_CONCURRENT, 2),
  };
}

export function getClientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return (
    h.get('x-real-ip') ??
    h.get('cf-connecting-ip') ??
    h.get('x-vercel-forwarded-for') ??
    'local'
  );
}

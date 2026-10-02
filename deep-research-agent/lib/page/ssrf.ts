import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from '@/lib/errors';

/**
 * SSRF protection.
 *
 * 1. Only http/https URLs are allowed.
 * 2. Hostnames that are obviously internal are refused outright.
 * 3. Every hostname is resolved with DNS and ALL returned addresses must be
 *    public before the request is made. Redirects are validated the same way,
 *    hop by hop, in fetch.ts.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.corp',
  '.home',
  '.home.arpa',
  '.lan',
  '.private',
  '.test',
  '.example',
  '.invalid',
  '.onion',
  '.in-addr.arpa',
  '.ip6.arpa',
];

const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 135, 137, 138, 139, 445, 465, 587, 993, 995, 1433, 1521, 2049, 2375, 2376, 3306, 3389, 5432, 5900,
  6379, 9200, 11211, 27017,
]);

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host.startsWith('[') || host.includes(':')) return false; // literal IPv6, checked later
  return false;
}

/* --------------------------------------------------------------- IPv4 ---- */

export function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const n = Number(p);
    if (n > 255) return undefined;
    out = out * 256 + n;
  }
  return out >>> 0;
}

export function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === undefined) return false;
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base);
    if (b === undefined) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) || // link-local + cloud metadata
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.0.2.0', 24) ||
    inRange('192.88.99.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15) ||
    inRange('198.51.100.0', 24) ||
    inRange('203.0.113.0', 24) ||
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) || // reserved / broadcast
    n === 0xffffffff
  );
}

/* --------------------------------------------------------------- IPv6 ---- */

function expandIpv6(input: string): number[] | undefined {
  let ip = input.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(':')) return undefined;

  // Pull an embedded IPv4 tail off the end (::ffff:1.2.3.4, 64:ff9b::1.2.3.4).
  let v4groups: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = ipv4ToInt(tail);
    if (n === undefined) return undefined;
    v4groups = [(n >>> 16) & 0xffff, n & 0xffff];
    ip = ip.slice(0, lastColon + 1);
  }

  const doubleColons = ip.split('::').length - 1;
  if (doubleColons > 1) return undefined;

  const [leftRaw = '', rightRaw = ''] = ip.split('::');
  const left = leftRaw.split(':').filter((x) => x !== '');
  const right = rightRaw.split(':').filter((x) => x !== '');
  const suffix = [...right, ...v4groups.map((n) => n.toString(16))];

  const filled = doubleColons === 1 ? 8 - left.length - suffix.length : 0;
  if (filled < 0) return undefined;
  if (doubleColons === 0 && left.length + suffix.length !== 8) return undefined;

  const groups = [...left, ...Array.from({ length: filled }, () => '0'), ...suffix];
  if (groups.length !== 8) return undefined;
  const nums = groups.map((g) => (g === '' ? NaN : parseInt(g, 16)));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return undefined;
  return nums;
}

export function isPrivateIpv6(input: string): boolean {
  const g = expandIpv6(input);
  if (!g) return false;
  const [a, b] = g;

  const isV4Mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (isV4Mapped) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isPrivateIpv4(v4);
  }
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address
  if (a === 0x0064 && b === 0xff9b) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isPrivateIpv4(v4);
  }
  if (a === 0x2002) {
    const v4 = `${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`;
    return isPrivateIpv4(v4);
  }
  if (g.every((x) => x === 0)) return true; // ::
  if (a === 0 && b === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) return true; // ::1
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

/* ------------------------------------------------------------ validator -- */

export interface UrlPolicy {
  allowLocalhost?: boolean;
  allowHttp?: boolean;
}

const DEFAULT_POLICY: UrlPolicy = { allowLocalhost: false, allowHttp: true };

/**
 * Throws unless the URL is a plain public http(s) resource.
 * Also resolves DNS and rejects hostnames pointing at private ranges.
 */
export async function assertPublicUrl(rawUrl: string, policy: UrlPolicy = {}): Promise<URL> {
  const pol = { ...DEFAULT_POLICY, ...policy };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('BAD_REQUEST', `Not a valid URL: ${String(rawUrl).slice(0, 120)}`, { status: 400 });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('BLOCKED_ADDRESS', `Blocked ${url.protocol}// link (only http and https are allowed).`, {
      status: 400,
    });
  }
  if (url.protocol === 'http:' && pol.allowHttp === false) {
    throw new AppError('BLOCKED_ADDRESS', 'Plain http links are disabled on this server.', { status: 400 });
  }
  if (url.username || url.password) {
    throw new AppError('BLOCKED_ADDRESS', 'URLs with embedded credentials are blocked.', { status: 400 });
  }

  const hostname = url.hostname.toLowerCase();
  if (!pol.allowLocalhost && isBlockedHostname(hostname)) {
    throw new AppError('BLOCKED_ADDRESS', `Blocked internal host "${hostname}".`, { status: 400 });
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!pol.allowLocalhost && BLOCKED_PORTS.has(port)) {
    throw new AppError('BLOCKED_ADDRESS', `Blocked port ${port}.`, { status: 400 });
  }

  // Literal IPs can be checked without DNS.
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (!pol.allowLocalhost && isPrivateIp(literal)) {
      throw new AppError('BLOCKED_ADDRESS', `Blocked private address ${literal}.`, { status: 400 });
    }
    return url;
  }

  if (pol.allowLocalhost) return url;

  // DNS: every resolved address must be public (blocks DNS-rebinding to internal IPs).
  let addresses: { address: string; family: number }[] = [];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError('NETWORK', `Could not resolve ${hostname}.`, { status: 502, retryable: true });
  }
  if (!addresses.length) {
    throw new AppError('NETWORK', `Could not resolve ${hostname}.`, { status: 502, retryable: true });
  }
  for (const a of addresses) {
    if (isPrivateIp(a.address)) {
      throw new AppError(
        'BLOCKED_ADDRESS',
        `Blocked ${hostname}: it resolves to the private address ${a.address}.`,
        { status: 400 },
      );
    }
  }
  return url;
}

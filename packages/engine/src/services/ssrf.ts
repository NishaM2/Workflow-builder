import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],       // this network
  ['10.0.0.0', 8],      // private
  ['100.64.0.0', 10],   // carrier-grade NAT
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local — cloud metadata lives here
  ['172.16.0.0', 12],   // private
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.168.0.0', 16],  // private
  ['198.18.0.0', 15],   // benchmarking
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reserved
];

function toInt(ipv4: string): number | null {
  const parts = ipv4.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);

  if (family === 4) {
    const address = toInt(ip);
    if (address === null) return true;

    return BLOCKED_V4.some(([base, bits]) => {
      const network = toInt(base)!;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (address & mask) === (network & mask);
    });
  }

  if (family === 6) {
    const normalized = ip.toLowerCase().split('%')[0]!;

    // IPv4-mapped (::ffff:127.0.0.1) — unwrap and re-check.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);

    if (normalized === '::1' || normalized === '::') return true;

    const head = normalized.split(':')[0] ?? '';
    if (/^f[cd]/.test(head)) return true;               // fc00::/7 unique local
    if (/^fe[89ab]/.test(head)) return true;            // fe80::/10 link-local
    return false;
  }

  return true; // not an IP at all — refuse
}

export interface UrlGuardOptions {
  // Escape hatch for local development only. Never true in production. 
  allowPrivate?: boolean;
}

// Throws BlockedAddressError unless the URL is safe to fetch. 
export async function assertUrlAllowed(
  rawUrl: string,
  options: UrlGuardOptions = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedAddressError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedAddressError(`Unsupported protocol: ${url.protocol}`);
  }

  if (options.allowPrivate) return;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new BlockedAddressError(`Cannot resolve host: ${hostname}`);
      });

  if (addresses.length === 0) {
    throw new BlockedAddressError(`Cannot resolve host: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BlockedAddressError(
        `Refusing to connect to a private or reserved address (${hostname})`,
      );
    }
  }
}
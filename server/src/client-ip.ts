import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import {
  convertIPv4MappedIPv6ToIPv4,
  convertIPv4ToBinary,
  convertIPv6ToBinary,
  distinctRemoteAddr,
  isIPv4MappedIPv6,
} from 'hono/utils/ipaddr';
import { env } from './env';

/**
 * Deriving the client IP from `x-forwarded-for` is only safe when the request
 * actually reached us through a proxy we control — the header is otherwise
 * fully attacker-controlled. A spoofed value lets an attacker impersonate a
 * victim's device fingerprint (IP + User-Agent) and skip the step-up email
 * challenge entirely. So we only trust the header when the immediate TCP peer
 * is within a configured set of trusted-proxy CIDRs (`TRUSTED_PROXIES`); with
 * no proxies configured we ignore the header and always use the peer address.
 */

type CidrRule = { isIPv4: boolean; addr: bigint; mask: bigint };

function parseCidr(rule: string): CidrRule {
  const slash = rule.indexOf('/');
  const addrStr = slash === -1 ? rule : rule.slice(0, slash);
  const type = distinctRemoteAddr(addrStr);
  if (type === undefined) throw new TypeError(`Invalid TRUSTED_PROXIES entry: ${rule}`);

  let isIPv4 = type === 'IPv4';
  const max = isIPv4 ? 32 : 128;
  const prefixStr = slash === -1 ? String(max) : rule.slice(slash + 1);
  const prefix = Number(prefixStr);
  if (!/^\d{1,3}$/.test(prefixStr) || prefix > max) {
    throw new TypeError(`Invalid TRUSTED_PROXIES entry: ${rule}`);
  }

  let addr = (isIPv4 ? convertIPv4ToBinary : convertIPv6ToBinary)(addrStr);
  let effectivePrefix = prefix;
  // Normalize IPv4-mapped IPv6 ranges (::ffff:a.b.c.d/N, N>=96) to plain IPv4
  // so they match peers reported as either form.
  if (!isIPv4 && isIPv4MappedIPv6(addr) && prefix >= 96) {
    isIPv4 = true;
    addr = convertIPv4MappedIPv6ToIPv4(addr);
    effectivePrefix = prefix - 96;
  }

  const bits = isIPv4 ? 32 : 128;
  const mask = effectivePrefix === 0 ? 0n : ((1n << BigInt(effectivePrefix)) - 1n) << BigInt(bits - effectivePrefix);
  return { isIPv4, addr: addr & mask, mask };
}

/** True if `address` falls inside any of the given trusted-proxy CIDRs. */
function isTrustedProxy(address: string, trusted: CidrRule[]): boolean {
  const type = distinctRemoteAddr(address);
  if (type === undefined) return false;

  const isIPv4 = type === 'IPv4';
  const binary = (isIPv4 ? convertIPv4ToBinary : convertIPv6ToBinary)(address);
  const ipv4Binary = isIPv4
    ? binary
    : isIPv4MappedIPv6(binary)
      ? convertIPv4MappedIPv6ToIPv4(binary)
      : undefined;

  for (const rule of trusted) {
    if (rule.isIPv4) {
      if (ipv4Binary !== undefined && (ipv4Binary & rule.mask) === rule.addr) return true;
    } else if (!isIPv4 && (binary & rule.mask) === rule.addr) {
      return true;
    }
  }
  return false;
}

/**
 * Builds a client-IP resolver bound to a fixed trusted-proxy list. Honors
 * `x-forwarded-for` only when `peer` is a trusted proxy, in which case it
 * returns the rightmost address in the chain that isn't itself a trusted
 * proxy (the real client). Exported for testing; production uses {@link getClientIp}.
 */
export function buildClientIpResolver(trustedProxyCidrs: string[]) {
  const trusted = trustedProxyCidrs.map((c) => c.trim()).filter(Boolean).map(parseCidr);

  return (peer: string | null, forwardedFor: string | null): string | null => {
    if (peer && trusted.length > 0 && isTrustedProxy(peer, trusted) && forwardedFor) {
      const chain = forwardedFor
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // Walk right-to-left, skipping proxies we added, to the first hop we
      // didn't put there — that's the address the edge proxy actually saw.
      for (let i = chain.length - 1; i >= 0; i--) {
        if (!isTrustedProxy(chain[i], trusted)) return chain[i];
      }
    }
    return peer;
  };
}

const resolve = buildClientIpResolver((env.TRUSTED_PROXIES ?? '').split(','));

/** Resolves the client IP for a Hono request using the configured trusted proxies. */
export function getClientIp(c: Context): string | null {
  return resolve(getConnInfo(c).remote.address ?? null, c.req.header('x-forwarded-for') ?? null);
}

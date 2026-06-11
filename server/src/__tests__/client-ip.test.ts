import { describe, expect, it } from 'vitest';
import { buildClientIpResolver } from '../client-ip';

describe('buildClientIpResolver', () => {
  describe('with no trusted proxies (default)', () => {
    const resolve = buildClientIpResolver([]);

    it('ignores x-forwarded-for and returns the peer address', () => {
      // The attack: peer is the load balancer, attacker spoofs the victim's IP.
      expect(resolve('198.51.100.1', '203.0.113.99')).toBe('198.51.100.1');
    });

    it('returns the peer when no forwarded header is present', () => {
      expect(resolve('198.51.100.1', null)).toBe('198.51.100.1');
    });

    it('returns null when there is no peer', () => {
      expect(resolve(null, '203.0.113.99')).toBeNull();
    });
  });

  describe('with a trusted proxy', () => {
    const resolve = buildClientIpResolver(['10.0.0.0/8']);

    it('trusts x-forwarded-for when the peer is the proxy', () => {
      expect(resolve('10.1.2.3', '203.0.113.99')).toBe('203.0.113.99');
    });

    it('ignores x-forwarded-for when the peer is NOT a trusted proxy', () => {
      // Attacker connects directly (not via the proxy) and spoofs the header.
      expect(resolve('198.51.100.1', '203.0.113.99')).toBe('198.51.100.1');
    });

    it('returns the rightmost untrusted hop in a multi-proxy chain', () => {
      // client -> edge -> internal proxy (peer). Both proxies are in 10/8.
      expect(resolve('10.0.0.2', '203.0.113.99, 10.0.0.1, 10.0.0.2')).toBe('203.0.113.99');
    });

    it('falls back to the peer when every hop is a trusted proxy', () => {
      expect(resolve('10.0.0.2', '10.0.0.1, 10.0.0.2')).toBe('10.0.0.2');
    });

    it('skips a spoofed extra hop appended before the real client', () => {
      // Attacker prepends a fake address; the real client is still the
      // rightmost non-proxy entry the edge proxy recorded.
      expect(resolve('10.0.0.1', 'fake-spoof, 203.0.113.99')).toBe('203.0.113.99');
    });
  });

  describe('IPv6 and mixed forms', () => {
    it('matches an IPv6 trusted proxy range', () => {
      const resolve = buildClientIpResolver(['2001:db8::/32']);
      expect(resolve('2001:db8::1', '203.0.113.5')).toBe('203.0.113.5');
      expect(resolve('2001:dead::1', '203.0.113.5')).toBe('2001:dead::1');
    });

    it('matches an IPv4 proxy reported as an IPv4-mapped IPv6 peer', () => {
      const resolve = buildClientIpResolver(['127.0.0.1/32']);
      expect(resolve('::ffff:127.0.0.1', '203.0.113.5')).toBe('203.0.113.5');
    });
  });

  describe('configuration validation', () => {
    it('throws on a malformed CIDR', () => {
      expect(() => buildClientIpResolver(['not-an-ip/24'])).toThrow(/Invalid TRUSTED_PROXIES/);
    });

    it('throws on an out-of-range prefix', () => {
      expect(() => buildClientIpResolver(['10.0.0.0/40'])).toThrow(/Invalid TRUSTED_PROXIES/);
    });

    it('ignores blank entries from a trailing/empty comma', () => {
      const resolve = buildClientIpResolver(['10.0.0.0/8', '', '  ']);
      expect(resolve('10.0.0.1', '203.0.113.5')).toBe('203.0.113.5');
    });
  });
});

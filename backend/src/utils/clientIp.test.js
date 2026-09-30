const { clientIp, ipBucket, inCloudflare, isIp, parseV4, parseV6 } = require('./clientIp');

const req = (ip, cf) => ({ ip, headers: cf === undefined ? {} : { 'cf-connecting-ip': cf } });

describe('clientIp', () => {
  test('behind a Cloudflare edge the client comes from CF-Connecting-IP', () => {
    // Kantadresser från nginx-loggen i produktion 2026-09-30.
    expect(clientIp(req('104.22.100.135', '81.227.40.12'))).toBe('81.227.40.12');
    expect(clientIp(req('172.71.191.117', '2001:db8::7'))).toBe('2001:db8::7');
    expect(clientIp(req('::ffff:172.68.245.68', '81.227.40.12'))).toBe('81.227.40.12');
    expect(clientIp(req('2606:4700:10::6816:1234', '81.227.40.12'))).toBe('81.227.40.12');
  });

  test('a header from anyone but Cloudflare is ignored', () => {
    expect(clientIp(req('203.0.113.9', '1.2.3.4'))).toBe('203.0.113.9');
    expect(clientIp(req('127.0.0.1', '1.2.3.4'))).toBe('127.0.0.1');
    // Skräp i headern från Cloudflares håll → kanten
    expect(clientIp(req('104.22.100.135', 'not-an-ip'))).toBe('104.22.100.135');
    expect(clientIp(req('104.22.100.135'))).toBe('104.22.100.135');
  });

  test('Cloudflare ranges', () => {
    expect(inCloudflare('104.23.209.115')).toBe(true);
    expect(inCloudflare('162.159.1.1')).toBe(true); // 162.158.0.0/15
    expect(inCloudflare('104.32.0.1')).toBe(false);
    expect(inCloudflare('2a06:98c7::1')).toBe(true); // /29
    expect(inCloudflare('2a06:98c8::1')).toBe(false);
    expect(inCloudflare('fe80::1')).toBe(false);
  });

  test('rate limits count an IPv6 connection as its /64 (review of #119)', () => {
    expect(ipBucket('2001:db8:1:2::a')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(ipBucket('81.227.40.12')).toBe('81.227.40.12');
    expect(ipBucket('::ffff:81.227.40.12')).toBe('81.227.40.12');
    expect(ipBucket('')).toBe('');
  });

  test('address parsing', () => {
    expect(parseV4('10.0.0.1')).toBe(167772161);
    expect(parseV4('256.0.0.1')).toBeNull();
    expect(parseV6('::1')).toBe(1n);
    expect(parseV6('::')).toBe(0n);
    expect(parseV6('::ffff:1.2.3.4')).toBe(0xffff01020304n);
    expect(parseV6('1:2:3:4:5:6:7:8')).toBe(0x00010002000300040005000600070008n);
    expect(parseV6('1::2::3')).toBeNull();
    expect(parseV6('1:2')).toBeNull();
    expect(isIp('2001:db8::7')).toBe(true);
    expect(isIp('hello')).toBe(false);
  });
});

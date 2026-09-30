// Klientens riktiga IP-adress bakom Cloudflare → Traefik → nginx → backend.
//
// Traefik litar inte på inkommande X-Forwarded-For (ingen forwardedHeaders-
// konfig) och skriver in sin närmaste granne — en Cloudflare-kant. Med
// `trust proxy 2` blir req.ip därför kantens adress, delad av alla som går via
// samma Cloudflare-datacenter (verifierat i nginx-loggen 2026-09-30). Alla
// per-IP-limitrar nycklade alltså på Cloudflare, inte på eleven.
//
// Cloudflare skickar klientens adress i CF-Connecting-IP. Den gäller bara när
// anropet faktiskt kom från Cloudflare — kanten ligger i Cloudflares
// publicerade nät — annars kunde den som når ursprunget direkt sätta headern
// själv och välja sin egen limiter-nyckel.
//
// Näten: https://www.cloudflare.com/ips-v4 och /ips-v6 (hämtade 2026-09-30,
// ändras sällan).
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32'
];

/** IPv4 som 32-bitars tal, eller null. */
function parseV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** IPv6 som 128-bitars BigInt, eller null. Klarar "::" och en inbäddad IPv4 på slutet. */
function parseV6(ip) {
  if (typeof ip !== 'string' || !ip.includes(':')) return null;
  let s = ip.replace(/%.*$/, ''); // zon-id (fe80::1%eth0)
  // En inbäddad IPv4 på slutet (::ffff:1.2.3.4) blir två vanliga grupper.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    s = `${s.slice(0, -v4[1].length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h) => (h === '' ? [] : h.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out = (out << 16n) + BigInt(parseInt(g, 16));
  }
  return out;
}

const V4_NETS = CLOUDFLARE_V4.map((c) => {
  const [base, bits] = c.split('/');
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return { base: (parseV4(base) & mask) >>> 0, mask };
});
const V6_NETS = CLOUDFLARE_V6.map((c) => {
  const [base, bits] = c.split('/');
  const shift = 128n - BigInt(bits);
  return { base: parseV6(base) >> shift, shift };
});

/** "::ffff:1.2.3.4" (IPv4 i IPv6-form) → "1.2.3.4". */
function normalize(ip) {
  if (typeof ip !== 'string') return '';
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip.trim());
  return m ? m[1] : ip.trim();
}

function isIp(ip) {
  const s = normalize(ip);
  return parseV4(s) !== null || parseV6(s) !== null;
}

function inCloudflare(ip) {
  const s = normalize(ip);
  const v4 = parseV4(s);
  if (v4 !== null) return V4_NETS.some((n) => ((v4 & n.mask) >>> 0) === n.base);
  const v6 = parseV6(s);
  if (v6 !== null) return V6_NETS.some((n) => (v6 >> n.shift) === n.base);
  return false;
}

/**
 * Nyckeln för per-adress-limitrar: IPv4-adressen, eller IPv6-adressens /64.
 * En IPv6-uppkoppling får normalt ett helt /64-nät och kan byta adress inom
 * det för varje anrop — nycklat på hela adressen vore gränsen ingen gräns.
 */
function ipBucket(ip) {
  const s = normalize(ip);
  if (parseV4(s) !== null) return s;
  const v6 = parseV6(s);
  if (v6 === null) return s;
  const prefix = v6 >> 64n;
  return `${[48n, 32n, 16n, 0n].map((sh) => ((prefix >> sh) & 0xffffn).toString(16)).join(':')}::/64`;
}

/**
 * Klientens adress för ett anrop: CF-Connecting-IP när anropet kom via en
 * Cloudflare-kant, annars req.ip (t.ex. lokalt, eller den som når ursprunget
 * direkt — då är req.ip redan deras egen adress).
 */
function clientIp(req) {
  const edge = normalize(req.ip);
  const header = req.headers?.['cf-connecting-ip'];
  const cf = typeof header === 'string' ? normalize(header) : '';
  if (cf && isIp(cf) && inCloudflare(edge)) return cf;
  return edge;
}

module.exports = { clientIp, ipBucket, inCloudflare, isIp, normalize, parseV4, parseV6 };

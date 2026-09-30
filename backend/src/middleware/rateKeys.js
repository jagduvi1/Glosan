// Nycklar för rate limiting. req.ip är klientens riktiga adress — app.js sätter
// den från utils/clientIp.js, eftersom allt annars skulle nycklas på
// Cloudflare-kanten. Inloggade nycklas per konto (en skolklass bakom en
// IP-adress ska inte dela en hink), anonyma per adress.
const jwt = require('jsonwebtoken');
const { ipBucket } = require('../utils/clientIp');

/**
 * Adressnyckeln för alla per-adress-limitrar: IPv4-adressen eller IPv6-nätets
 * /56 (utils/clientIp.js). Varje limiter som nycklar på adress ska använda den
 * här — express-rate-limits standardnyckel är hela req.ip.
 */
function ipKey(req) {
  return ipBucket(req.ip);
}

/**
 * Kontots id från en äkta JWT i Authorization-headern, annars null. Signaturen
 * verifieras — ett påhittat id ska inte ge en egen, ny hink. En token som
 * nyss gått ut räknas ändå på kontot: varje aktiv elev skickar en sådan var
 * femtonde minut (appen refreshar först på ett 401), och i skolans delade
 * adresshink skulle klassen till slut få 429 i stället för 401 — och aldrig
 * refresha. Äldre än 7 dagar (refresh-cookiens livslängd) → per adress.
 * MCP-tokens (glo_) hör till /api/mcp:s egna limitrar. Cachas på req.
 */
function verifiedUserId(req) {
  if (req._rateUserId !== undefined) return req._rateUserId;
  let id = null;
  const h = req.headers?.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ') && !h.startsWith('Bearer glo_')) {
    try {
      id = jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'], ignoreExpiration: true, maxAge: '7d' }).id || null;
    } catch {
      id = null; // falsk eller mycket gammal — per adress
    }
  }
  req._rateUserId = id ? String(id) : null;
  return req._rateUserId;
}

/** Per konto för inloggade, annars per adress. */
function userOrIpKey(req) {
  const id = verifiedUserId(req);
  return id ? `u:${id}` : `ip:${ipKey(req)}`;
}

module.exports = { ipKey, verifiedUserId, userOrIpKey };

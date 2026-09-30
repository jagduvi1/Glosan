// Limitrarna för inloggning, registrering, refresh och mail (routes/auth.js).
//
// Glosan används i klassrum: en hel klass bakom SAMMA skol-IP loggar in,
// registrerar sig och går med via QR-kod på några minuter. Ren per-IP-gräns
// (20 per kvart) stängde då ute elev 21–30. Därför nycklas varje gräns på det
// den skyddar — ett konto, en session, en mottagaradress — med ett högt tak per
// adress som bara stoppar den som hamrar på många konton.
// (req.ip är klientens riktiga adress bakom Cloudflare — utils/clientIp.js.)
const rateLimit = require('express-rate-limit');
const { parseRefreshToken } = require('../services/authTokens');

const MIN15 = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const limiter = (opts, message) => rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: message }),
  ...opts
});

const lower = (v) => String(v ?? '').trim().toLowerCase().slice(0, 200);

/** Inloggningsförsök per adress + användarnamn: 20 per kvart. */
const loginLimiter = limiter({
  windowMs: MIN15,
  max: 20,
  keyGenerator: (req) => `login:${req.ip}:${lower(req.body?.username)}`
}, 'Too many attempts, please try again later');

/** Tak per adress för alla anonyma auth-anrop (många konton från en adress). */
const authFloodLimiter = limiter({
  windowMs: MIN15,
  max: 300,
  keyGenerator: (req) => `authflood:${req.ip}`
}, 'Too many attempts, please try again later');

/** Nya konton per adress: en klass (30) med marginal, inte en spam-fabrik. */
const registerLimiter = limiter({
  windowMs: MIN15,
  max: 60,
  keyGenerator: (req) => `register:${req.ip}`
}, 'Too many attempts, please try again later');

/**
 * Engångslänkar (verifiera e-post, återställ lösenord, magisk länk): tokens är
 * 256-bitars slump, så gränsen skyddar bara mot översvämning.
 */
const tokenLimiter = limiter({
  windowMs: MIN15,
  max: 100,
  keyGenerator: (req) => `token:${req.ip}`
}, 'Too many attempts, please try again later');

/** Refresh och utloggning per session (refresh-cookiens familj), annars per adress. */
const refreshLimiter = limiter({
  windowMs: MIN15,
  max: 60,
  keyGenerator: (req) => {
    const parsed = parseRefreshToken(req.cookies?.refreshToken);
    return parsed ? `refresh:${parsed.family}` : `refreship:${req.ip}`;
  }
}, 'Too many refresh attempts, please try again later');

/** Tak per adress för refresh — en skola full av elever ryms. */
const refreshFloodLimiter = limiter({
  windowMs: MIN15,
  max: 1000,
  keyGenerator: (req) => `refreshflood:${req.ip}`
}, 'Too many refresh attempts, please try again later');

// Mail kostar pengar (Resend) och kan trakassera en mottagare: per
// mottagaradress, plus ett tak per avsändande adress.
const MAIL_MESSAGE = 'Vänta en stund innan du begär ett nytt mail.';

const mailLimiter = limiter({
  windowMs: HOUR,
  max: 5,
  keyGenerator: (req) => `mail:${lower(req.body?.email)}`
}, MAIL_MESSAGE);

const mailFloodLimiter = limiter({
  windowMs: HOUR,
  max: 30,
  keyGenerator: (req) => `mailflood:${req.ip}`
}, MAIL_MESSAGE);

/** Nytt verifieringsmail — kräver inloggning, så per konto. */
const resendLimiter = limiter({
  windowMs: HOUR,
  max: 5,
  keyGenerator: (req) => `resend:${req.user?.id || req.ip}`
}, MAIL_MESSAGE);

module.exports = {
  loginLimiter,
  authFloodLimiter,
  registerLimiter,
  tokenLimiter,
  refreshLimiter,
  refreshFloodLimiter,
  mailLimiter,
  mailFloodLimiter,
  resendLimiter
};

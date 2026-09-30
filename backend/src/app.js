const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { clientIp } = require('./utils/clientIp');
const { userOrIpKey, ipKey } = require('./middleware/rateKeys');

const healthRoute = require('./routes/health');
const authRoute = require('./routes/auth');
const oauthRoute = require('./routes/oauth');
const listsRoute = require('./routes/lists');
const listInvitesRoute = require('./routes/listInvites');
const glosorRoute = require('./routes/glosor');
const aiRoute = require('./routes/ai');
const meRoute = require('./routes/me');
const categoriesRoute = require('./routes/categories');
const friendsRoute = require('./routes/friends');
const coopStreaksRoute = require('./routes/coopStreaks');
const duelsRoute = require('./routes/duels');
const leaderboardsRoute = require('./routes/leaderboards');
const adminRoute = require('./routes/admin');
const mcpRoute = require('./routes/mcp');
const mcpOAuthRoute = require('./routes/mcpOAuth');
const wellKnownOAuthRoute = require('./routes/wellKnownOAuth');
const studyRoute = require('./routes/study');
const studyInvitesRoute = require('./routes/studyInvites');

const app = express();

app.set('trust proxy', 2);

// req.ip = klientens riktiga adress bakom Cloudflare (utils/clientIp.js). Med
// bara trust proxy blev det Cloudflare-kanten, delad av alla som går via samma
// datacenter — så varje per-IP-gräns delades av främlingar.
app.use((req, res, next) => {
  Object.defineProperty(req, 'ip', { value: clientIp(req), configurable: true, enumerable: true });
  next();
});

// API:t returnerar bara JSON, så CSP-headern har ingen praktisk effekt här —
// SPA:s CSP sätts av nginx (se frontend/nginx.conf). Vi behåller HSTS,
// frameguard, content-type-sniffning och en strikt CSP som extra lager för
// browsers som av misstag hamnar på en API-URL.
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use(compression());
app.use(cookieParser());

// OAuth-discovery för MCP-connectorn (RFC 8414 + RFC 9728). Måste ligga på
// originets rot och före CORS/limitrarna — se routes/wellKnownOAuth.js.
// nginx proxar /.well-known/oauth-* hit (frontend/nginx.conf).
// Nödbroms för AI-anslutningen (MCP): MCP_DISABLED=true stänger discovery,
// OAuth och /api/mcp med 503 — utan ny release (starta om backend).
if (process.env.MCP_DISABLED === 'true') {
  app.use(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/api/mcp'], (req, res) => {
    res.status(503).json({ error: 'The Glosan AI connection is switched off for now.' });
  });
}
app.use('/.well-known', wellKnownOAuthRoute);

// Bildimporten skickar en nerskalad JPEG som base64 och spränger därför
// 64 kB-taket nedan. Den högre gränsen gäller BARA den routen — resten av
// API:t ligger kvar på 64 kB, vilket är ett medvetet skydd mot uppsvällda
// requests. Monterad FÖRE den globala parsern: body-parser sätter req._body
// och den globala hoppar då över en redan parsad body.
app.use('/api/ai/parse-image', express.json({ limit: '2mb' }));
// MCP: ett create_list-anrop med ett helt kapitels ord kan passera 64 kB.
// Gäller hela /api/mcp-prefixet (inkl. OAuth-endpointsen); nginx har samma tak.
app.use('/api/mcp', express.json({ limit: '1mb' }));
// Ett övningsprov lämnas in i ett anrop: 40 svar, öppna svar upp till 2000
// tecken (å/ä/ö är två byte) — mer än 64 kB. Bara den routen; nginx likadant.
app.use(/^\/api\/study\/tests\/attempts\/[^/]+\/submit$/, express.json({ limit: '256kb' }));
app.use(express.json({ limit: '64kb' }));

// FRONTEND_URL kan vara en enstaka URL eller en kommaseparerad lista —
// stödet för flera origins behövs när appen serveras från fler domäner
// (t.ex. glosan.app + glosan.jeklund.dev under en migrationsperiod).
const corsOrigin = (() => {
  const raw = process.env.FRONTEND_URL;
  if (!raw) return process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
})();
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.warn('[security] FRONTEND_URL is not set — CORS will block cross-origin requests in production');
}
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Routes med EGNA limitrar är undantagna från de globala per-IP-limitrarna,
// eftersom många användare delar IP-adress där:
// - MCP-protokollet och dess OAuth-endpoints: hostade AI-connectors
//   (claude.ai, ChatGPT) går ut från en liten delad IP-pool. Egna limitrar i
//   routes/mcp.js och routes/mcpOAuth.js. (/api/mcp/connections, Profil-sidan,
//   är en vanlig webbapp-route och omfattas som vanligt.)
// - Plugga (/api/study): en skolklass delar ofta en IP-adress, och pass och
//   prov skickar ett anrop per svar. Begränsas per inloggad användare i
//   routes/study.js.
// - Inloggning, registrering, refresh och mail (routes/auth.js): per konto,
//   session eller mottagare, med högre tak per adress (middleware/authLimits.js).
//   Google-inloggningen (routes/oauth.js) har ett eget tak per adress.
//   Refresh skickar aldrig en JWT, så här skulle en hel skola annars dela 100
//   skrivanrop per kvart — och ett 429 på refresh loggar ut eleven.
// Bara sökvägar som finns — en okänd sökväg under /api/mcp/oauth/ eller
// /api/auth/ ska inte slippa undan alla limitrar.
const MCP_OAUTH_PATHS = new Set(['register', 'authorize', 'client', 'approve', 'token', 'revoke'].map((p) => `/api/mcp/oauth/${p}`));
const AUTH_OWN_PATHS = new Set([
  'register', 'login', 'refresh', 'logout', 'verify-email', 'reset-password', 'forgot-password',
  'magic-link', 'magic-link/consume', 'resend-verification', 'sso/providers', 'google', 'google/callback'
].map((p) => `/api/auth/${p}`));
const hasOwnLimiter = (req) => {
  const p = (req.baseUrl || '') + (req.path || '');
  return p === '/api/mcp' || p === '/api/mcp/' || MCP_OAUTH_PATHS.has(p) || AUTH_OWN_PATHS.has(p)
    || p === '/api/study' || p.startsWith('/api/study/');
};

// Inloggade nycklas per konto, anonyma per adress (middleware/rateKeys.js) —
// en klass bakom samma skol-IP delar inte på 300 anrop.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: hasOwnLimiter,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests, please try again later' })
});
app.use('/api/', apiLimiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: (req) => hasOwnLimiter(req) || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  handler: (req, res) => res.status(429).json({ error: 'Too many write requests, please try again later' })
});
app.use('/api/', writeLimiter);

app.use('/api/health', healthRoute);
app.use('/api/auth', authRoute);
// SSO-/OAuth-endpoints (Google) bor under samma /api/auth-prefix. Monteras
// efter authRoute; subpaths (/google, /sso/providers) krockar inte med
// lösenordsrouterna.
app.use('/api/auth', oauthRoute);
// MCP-servern (Model Context Protocol) — låter claude.ai m.fl. skapa och
// redigera användarens listor. Se docs/mcp.md. Monteras FÖRE routrarna på
// '/api' nedan: glosor-routern kör router.use(requireAuth) på hela
// /api-prefixet och skulle annars svara 401 på varje OAuth-anrop och varje
// glo_-token innan de når hit (app.mcp.test.js vaktar ordningen). OAuth-
// servern före /api/mcp så /api/mcp/oauth/* hamnar rätt.
app.use('/api/mcp/oauth', mcpOAuthRoute);
app.use('/api/mcp', mcpRoute);
// Plugga (skolämnen) — dold bakom funktionsflaggan 'study'. Se docs/plugga.md.
app.use('/api/study', studyRoute);
app.use('/api/lists', listsRoute);
// listInvites monteras på /api/ eftersom routes har paths som
// /lists/:id/share-link (under /lists) och /list-invite/:code (top-level)
app.use('/api', listInvitesRoute);
// Delningslänkar till Plugga-områden (/p/<kod>) — publik förhandsvisning, så
// den måste ligga före glosor-routern (samma skäl som listInvites).
app.use('/api', studyInvitesRoute);
app.use('/api', glosorRoute);
app.use('/api/ai', aiRoute);
app.use('/api/me', meRoute);
app.use('/api/categories', categoriesRoute);
app.use('/api/me', friendsRoute);
app.use('/api/me', coopStreaksRoute);
app.use('/api/duels', duelsRoute);
app.use('/api/me', leaderboardsRoute);
app.use('/api/admin', adminRoute);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log only what we control — namn, meddelande, stack och request-vägen.
  // Hela err-objektet kan släpa med req.body / headers (lösenord, tokens,
  // mail), vilket är personuppgifter vi inte vill ha i loggarna.
  const status = err.status || err.statusCode || 500;
  console.error('[error]', {
    method: req.method,
    path: req.path,
    status,
    name: err.name,
    message: err.message,
    stack: err.stack
  });
  const message = process.env.NODE_ENV === 'production' && status >= 500
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
});

module.exports = app;

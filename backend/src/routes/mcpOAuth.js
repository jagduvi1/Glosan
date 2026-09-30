const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const McpToken = require('../models/McpToken');
const OAuthClient = require('../models/OAuthClient');
const OAuthAuthCode = require('../models/OAuthAuthCode');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { effectiveFeatures, FEATURE_FIELDS } = require('../config/features');
const {
  issuer, resourceUrl, verifyPkce, grantedScopes, redirectUriRegistered,
  rotateCredentials, tokenResponse, redirectTrust,
  REFRESH_GRACE_MS, REFRESH_HISTORY, IDLE_EXPIRY_MS, CODE_CHALLENGE_RE, MAX_STATE_LENGTH
} = require('../services/mcpOAuth');

// OAuth 2.1-auktoriseringsservern för MCP-connectorn. Porterad från Cellarion
// (routes/mcpOAuth.js), avskalad på audit-logg och admin-justerbara gränser.
// Monterad på /api/mcp/oauth:
//   POST /register   RFC 7591 Dynamic Client Registration (publik, rate-limitad)
//   GET  /authorize  validera, skicka sedan browsern till samtyckessidan
//   GET  /client     klientens namn och redirect-värd för samtyckessidan
//   POST /approve    den inloggade användarens samtycke → engångskod
//   POST /token      kod → token + rotation av refresh-token
//   POST /revoke     RFC 7009-återkallning
//
// Flödet: klienten anropar /api/mcp utan token → 401 + WWW-Authenticate →
// hämtar PRM → AS-metadata → registrerar sig → öppnar /authorize i
// användarens browser → vi 302:ar till /connect-ai/authorize → användaren
// loggar in och godkänner → /approve mintar en kod → klienten växlar koden
// med sin PKCE-verifier på /token → får en glo_-token för /api/mcp.

const router = express.Router();

// Hostade plattformar (claude.ai, ChatGPT) går ut från en liten delad IP-pool,
// så "per IP" betyder i praktiken "alla användare på den plattformen". Därför
// är de här endpointsen undantagna från de globala limitrarna i app.js och har
// egna, generösa tak. /register är striktare: varje anrop skapar en rad.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'invalid_request', error_description: 'Too many client registrations from this address; try again later.' }
});

// Ett tak som FINNS, inte ett snävt — det begränsar oautentiserad DB-last och
// antalet auth-kodrader. Koder och refresh-tokens är 256-bitars slump, så det
// här är inte ett skydd mot gissning.
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // RFC 6749 §5.2-formad body — en OAuth-klient som får en naken
  // {error:"..."} rapporterar "trasig server" i stället för orsaken.
  handler: (req, res) => res.status(429).json({
    error: 'temporarily_unavailable',
    error_description: 'Too many OAuth requests from this address; try again in a few minutes.'
  })
});

// /token och /revoke skickas som application/x-www-form-urlencoded (RFC 6749
// §4.1.3 / RFC 7009). Den globala express.json() tar bara JSON.
router.use(express.urlencoded({ extended: false, limit: '10kb' }));

const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_LEN = 2048;
// Claude + ChatGPT + Desktop + … — generöst, men begränsat.
const MAX_CONNECTIONS_PER_USER = 20;

// ── felhjälpare (RFC 6749 §5.2) ──────────────────────────────────────────────
function oauthError(res, status, error, description) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error, error_description: description });
}
// Fel EFTER att redirect_uri validerats går tillbaka till klienten som
// query-parametrar på redirecten (RFC 6749 §4.1.2.1), med state bevarat —
// men bara till en värd vi känner igen. Vem som helst kan registrera en
// klient, så annars vore /authorize en öppen redirect till valfri sajt.
function redirectError(res, redirectUri, error, description, state) {
  if (redirectTrust(redirectUri) === 'unknown') return oauthError(res, 400, error, description);
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (description) u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  return res.redirect(302, u.toString());
}

function isValidRedirectUri(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol === 'https:') return true;
  // Loopback för native-klienter (RFC 8252) — http bara på localhost.
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
}

// ── POST /register — Dynamic Client Registration (RFC 7591) ──────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
      return oauthError(res, 400, 'invalid_redirect_uri', `redirect_uris must be a non-empty array of at most ${MAX_REDIRECT_URIS} URLs`);
    }
    if (!redirectUris.every((u) => typeof u === 'string' && u.length <= MAX_REDIRECT_URI_LEN)) {
      return oauthError(res, 400, 'invalid_redirect_uri', `each redirect_uri must be a string of at most ${MAX_REDIRECT_URI_LEN} characters`);
    }
    if (!redirectUris.every(isValidRedirectUri)) {
      return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris must all be https, or http on a loopback host');
    }
    // Bara de två metoder token-endpointen faktiskt implementerar.
    const authMethod = body.token_endpoint_auth_method || 'none';
    if (!['none', 'client_secret_post'].includes(authMethod)) {
      return oauthError(res, 400, 'invalid_client_metadata', 'token_endpoint_auth_method must be "none" or "client_secret_post"');
    }

    const clientId = OAuthClient.generateClientId();
    let rawSecret = null;
    let clientSecretHash = null;
    if (authMethod !== 'none') {
      rawSecret = OAuthClient.generateClientSecret();
      clientSecretHash = OAuthClient.hashSecret(rawSecret);
    }

    const client = await OAuthClient.create({
      clientId,
      clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null,
      redirectUris,
      tokenEndpointAuthMethod: authMethod,
      clientSecretHash,
      // Städas bort om den aldrig växlar en kod; nollställs vid första token.
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: client.clientName || undefined,
      ...(rawSecret ? { client_secret: rawSecret, client_secret_expires_at: 0 } : {})
    });
  } catch (err) {
    console.error('MCP DCR register error:', err.message);
    return oauthError(res, 500, 'server_error', 'registration failed');
  }
});

// ── GET /authorize — validera, lämna sedan över till samtyckessidan ─────────
router.get('/authorize', oauthLimiter, async (req, res) => {
  try {
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, scope, state, resource } = req.query;

    // Klient + redirect_uri valideras FÖRST och före varje redirect: en okänd
    // klient eller oregistrerad redirect_uri får aldrig redirectas till
    // (open redirect / kodläcka) — de får ett rent 400.
    if (!client_id || typeof client_id !== 'string') return oauthError(res, 400, 'invalid_request', 'client_id is required');
    const client = await OAuthClient.findOne({ clientId: client_id });
    if (!client) return oauthError(res, 400, 'invalid_client', 'unknown client_id');
    if (typeof redirect_uri !== 'string' || !redirectUriRegistered(client, redirect_uri)) {
      return oauthError(res, 400, 'invalid_request', 'redirect_uri does not match a registered URI');
    }

    // Härifrån är redirect_uri registrerad, så protokollfel går tillbaka dit
    // (om värden är känd — se redirectError).
    if (state !== undefined && (typeof state !== 'string' || state.length > MAX_STATE_LENGTH)) {
      return oauthError(res, 400, 'invalid_request', `state must be a string of at most ${MAX_STATE_LENGTH} characters`);
    }
    const st = typeof state === 'string' ? state : undefined;
    if (response_type !== 'code') return redirectError(res, redirect_uri, 'unsupported_response_type', 'only response_type=code is supported', st);
    if (typeof code_challenge !== 'string' || !CODE_CHALLENGE_RE.test(code_challenge) || code_challenge_method !== 'S256') {
      return redirectError(res, redirect_uri, 'invalid_request', 'PKCE code_challenge (43 base64url characters) with method S256 is required', st);
    }
    if (resource && resource !== resourceUrl()) {
      return redirectError(res, redirect_uri, 'invalid_target', 'resource must be the MCP endpoint URL', st);
    }

    // Samtyckessidan får den validerade förfrågan. Användaren loggar in där och
    // godkänner; frontend POST:ar till /approve som validerar ALLT igen.
    const consent = new URL(`${issuer()}/connect-ai/authorize`);
    consent.searchParams.set('client_id', client_id);
    consent.searchParams.set('redirect_uri', redirect_uri);
    consent.searchParams.set('code_challenge', code_challenge);
    consent.searchParams.set('code_challenge_method', 'S256');
    consent.searchParams.set('scope', typeof scope === 'string' ? scope : '');
    if (st) consent.searchParams.set('state', st);
    if (typeof resource === 'string' && resource) consent.searchParams.set('resource', resource);
    // Klientens namn skickas INTE med: sidan hämtar det från GET /client, så
    // en länk inte kan påstå att den kommer från "Claude".
    return res.redirect(302, consent.toString());
  } catch (err) {
    console.error('MCP OAuth authorize error:', err.message);
    return oauthError(res, 500, 'server_error', 'authorization failed');
  }
});

// ── GET /client — vem vill ansluta? (för samtyckessidan) ─────────────────────
// Namnet valde klienten själv vid registreringen, så det räcker inte som
// identitet: sidan visar också redirect-värden och varnar när den är okänd.
router.get('/client', oauthLimiter, async (req, res) => {
  try {
    const { client_id, redirect_uri } = req.query;
    if (typeof client_id !== 'string' || typeof redirect_uri !== 'string') {
      return oauthError(res, 400, 'invalid_request', 'client_id and redirect_uri are required');
    }
    const client = await OAuthClient.findOne({ clientId: client_id });
    if (!client || !redirectUriRegistered(client, redirect_uri)) return oauthError(res, 404, 'invalid_client', 'unknown client');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      client_name: client.clientName || null,
      redirect_host: new URL(redirect_uri).host,
      trust: redirectTrust(redirect_uri)
    });
  } catch (err) {
    console.error('MCP OAuth client info error:', err.message);
    return oauthError(res, 500, 'server_error', 'client lookup failed');
  }
});

// ── POST /approve — den inloggade användarens beslut ─────────────────────────
// Bara JWT (requireAuth tar aldrig en glo_-token): den som samtycker är en
// riktig inloggad användare. Hela förfrågan valideras mot DB igen — rundturen
// via samtyckessidan är UX, inte förtroende.
router.post('/approve', oauthLimiter, requireAuth, async (req, res) => {
  try {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, scope, state, resource, approved } = req.body || {};

    // typeof-vakt före queryn: bodyn är JSON, så ett objektvärde
    // ({"$ne":null}) skulle annars nå Mongo som operator.
    if (typeof client_id !== 'string') return res.status(400).json({ error: 'unknown client' });
    const client = await OAuthClient.findOne({ clientId: client_id });
    if (!client) return res.status(400).json({ error: 'unknown client' });
    if (typeof redirect_uri !== 'string' || !redirectUriRegistered(client, redirect_uri)) {
      return res.status(400).json({ error: 'redirect_uri does not match a registered URI' });
    }
    if (state !== undefined && state !== null && (typeof state !== 'string' || state.length > MAX_STATE_LENGTH)) {
      return res.status(400).json({ error: 'invalid state' });
    }
    const st = typeof state === 'string' && state ? state : null;

    // Nekat → tillbaka till klienten med ett fel (ingen kod).
    if (approved !== true) {
      const u = new URL(redirect_uri);
      u.searchParams.set('error', 'access_denied');
      if (st) u.searchParams.set('state', st);
      return res.json({ redirect: u.toString() });
    }

    if (typeof code_challenge !== 'string' || !CODE_CHALLENGE_RE.test(code_challenge) || code_challenge_method !== 'S256') {
      return res.status(400).json({ error: 'PKCE S256 challenge required' });
    }
    if (resource && resource !== resourceUrl()) {
      return res.status(400).json({ error: 'invalid resource' });
    }
    // En inloggning från före en lösenordsåterställning får inte koppla en AI
    // (en stulen JWT lever upp till 15 min efter bytet).
    const me = await User.findById(req.user.id, `credentialsChangedAt ${FEATURE_FIELDS}`).lean();
    if (!me) return res.status(401).json({ error: 'Logga in igen.' });
    if (me.credentialsChangedAt && !(req.user.iat >= Math.floor(me.credentialsChangedAt.getTime() / 1000))) {
      return res.status(401).json({ error: 'Logga in igen.' });
    }

    // Användarens VAL: samtyckessidan får smalna av (t.ex. "bara läsa"), men
    // aldrig vidga. Valet måste vara en delmängd av det klienten bad om, och
    // 'read' är golvet. `scopes` saknas → hela erbjudandet.
    const offered = grantedScopes(scope);
    let scopes = offered;
    if (req.body.scopes !== undefined) {
      const chosen = req.body.scopes;
      if (!Array.isArray(chosen) || chosen.length === 0 || chosen.some((s) => typeof s !== 'string')) {
        return res.status(400).json({ error: 'scopes must be a non-empty array of scope strings' });
      }
      const invalid = chosen.filter((s) => !offered.includes(s));
      if (invalid.length) return res.status(400).json({ error: `scopes not requested by the client: ${invalid.join(', ')}` });
      if (!chosen.includes('read')) return res.status(400).json({ error: 'the read scope is required' });
      scopes = offered.filter((s) => chosen.includes(s));
    }

    const rawCode = OAuthAuthCode.generateCode();
    await OAuthAuthCode.create({
      codeHash: OAuthAuthCode.hashCode(rawCode),
      clientId: client_id,
      user: req.user.id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      scopes,
      // Det samtyckessidan visade (t.ex. pluggområden) — anslutningen når
      // aldrig mer än så, även om fler moduler slås på senare.
      modules: effectiveFeatures(me),
      resource: resource || resourceUrl(),
      expiresAt: new Date(Date.now() + OAuthAuthCode.AUTH_CODE_TTL_MS)
    });

    const u = new URL(redirect_uri);
    u.searchParams.set('code', rawCode);
    if (st) u.searchParams.set('state', st);
    return res.json({ redirect: u.toString() });
  } catch (err) {
    console.error('MCP OAuth approve error:', err.message);
    return res.status(500).json({ error: 'consent failed' });
  }
});

/**
 * Autentisera klienten på /token och /revoke. Publika klienter visar bara
 * client_id; konfidentiella även client_secret. Returnerar OAuthClient eller null.
 */
async function authenticateClient(req) {
  const clientId = req.body?.client_id;
  if (!clientId || typeof clientId !== 'string') return null;
  const client = await OAuthClient.findOne({ clientId });
  if (!client) return null;
  if (client.tokenEndpointAuthMethod === 'none') return client;
  const secret = req.body.client_secret;
  if (typeof secret !== 'string' || !client.clientSecretHash) return null;
  const a = Buffer.from(OAuthClient.hashSecret(secret));
  const b = Buffer.from(client.clientSecretHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return client;
}

// ── POST /token — kodväxling + refresh-rotation ──────────────────────────────
router.post('/token', oauthLimiter, async (req, res) => {
  try {
    const client = await authenticateClient(req);
    if (!client) return oauthError(res, 401, 'invalid_client', 'client authentication failed');
    const grantType = req.body.grant_type;

    if (grantType === 'authorization_code') {
      const { code, code_verifier, redirect_uri, resource } = req.body;
      // typeof, inte truthiness: app.js JSON-parsar /api/mcp-prefixet, så en
      // klient med Content-Type: application/json kan skicka objekt här.
      if (typeof code !== 'string' || !code || typeof code_verifier !== 'string' || !code_verifier) {
        return oauthError(res, 400, 'invalid_request', 'code and code_verifier are required');
      }

      // Engångs: gör anspråk på koden atomärt (consumedAt null → nu). En
      // replay eller en omsändning hittar den redan förbrukad.
      const codeDoc = await OAuthAuthCode.findOneAndUpdate(
        { codeHash: OAuthAuthCode.hashCode(code), consumedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } },
        { new: false }
      );
      if (!codeDoc) return oauthError(res, 400, 'invalid_grant', 'authorization code is invalid, expired, or already used');
      if (codeDoc.clientId !== client.clientId) return oauthError(res, 400, 'invalid_grant', 'code was issued to a different client');
      if (redirect_uri && redirect_uri !== codeDoc.redirectUri) return oauthError(res, 400, 'invalid_grant', 'redirect_uri mismatch');
      if (!verifyPkce(code_verifier, codeDoc.codeChallenge)) return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
      if (resource && resource !== (codeDoc.resource || resourceUrl())) return oauthError(res, 400, 'invalid_target', 'resource mismatch');
      // Lösenordet återställt efter att koden skapades (eller kontot borta) → ogiltig.
      const owner = await User.findById(codeDoc.user, 'credentialsChangedAt').lean();
      if (!owner || (owner.credentialsChangedAt && codeDoc.createdAt < owner.credentialsChangedAt)) {
        return oauthError(res, 400, 'invalid_grant', 'authorization code is invalid, expired, or already used');
      }

      const active = await McpToken.countDocuments({ user: codeDoc.user, revokedAt: null });
      if (active >= MAX_CONNECTIONS_PER_USER) {
        return oauthError(res, 400, 'invalid_grant', `too many active AI connections (max ${MAX_CONNECTIONS_PER_USER}); remove one on your Glosan profile page`);
      }

      const cred = rotateCredentials();
      await McpToken.create({
        user: codeDoc.user,
        name: client.clientName ? client.clientName.slice(0, 120) : 'Ansluten AI',
        scopes: codeDoc.scopes,
        ...(Array.isArray(codeDoc.modules) ? { modules: [...codeDoc.modules] } : {}),
        oauthClientId: client.clientId,
        resource: codeDoc.resource || resourceUrl(),
        ...cred.fields
      });
      // Använd → klienten blir permanent (ta bort städ-TTL:en).
      OAuthClient.updateOne({ _id: client._id }, { $set: { lastUsedAt: new Date() }, $unset: { expiresAt: '' } }).catch(() => {});
      res.setHeader('Cache-Control', 'no-store');
      return res.json(tokenResponse(cred.raw.access, cred.raw.refresh, codeDoc.scopes));
    }

    if (grantType === 'refresh_token') {
      const { refresh_token } = req.body;
      if (typeof refresh_token !== 'string' || !refresh_token) {
        return oauthError(res, 400, 'invalid_request', 'refresh_token is required');
      }
      const presented = McpToken.hashToken(refresh_token);
      const now = new Date();
      const token = await McpToken.findOne({ refreshTokenHash: presented, revokedAt: null, oauthClientId: client.clientId });

      if (token) {
        // En anslutning som inte använts på 90 dagar har somnat.
        const lastActive = Math.max(...[token.lastUsedAt, token.rotatedAt, token.createdAt].filter(Boolean).map((d) => d.getTime()));
        if (now.getTime() - lastActive > IDLE_EXPIRY_MS) {
          await McpToken.updateOne({ _id: token._id, revokedAt: null }, { $set: { revokedAt: now } });
          return oauthError(res, 400, 'invalid_grant', 'the connection was unused for too long — connect the AI again');
        }
        // Rotera BÅDA (OAuth 2.1 §4.3.1) i ett steg: hashen i filtret gör att
        // bara en av två samtidiga refresh:ar vinner. Den förbrukade hashen
        // läggs i historiken (de senaste REFRESH_HISTORY).
        const cred = rotateCredentials();
        const rotated = await McpToken.findOneAndUpdate(
          { _id: token._id, refreshTokenHash: presented, revokedAt: null },
          {
            $set: { ...cred.fields, rotatedAt: now },
            $push: { prevRefreshTokenHashes: { $each: [presented], $slice: -REFRESH_HISTORY } }
          },
          { new: true }
        );
        if (rotated) {
          res.setHeader('Cache-Control', 'no-store');
          return res.json(tokenResponse(cred.raw.access, cred.raw.refresh, rotated.scopes));
        }
        // Förlorade racet mot en samtidig refresh — nekas nedan som en omsändning.
      }

      // ÅTERANVÄNDNINGSDETEKTION (OAuth 2.1 BCP §4.14.2): en förbrukad
      // refresh-token från den här anslutningen = den har läckt. Vi kan inte
      // skilja tjuv från offer, så hela anslutningen dör och användaren
      // godkänner på nytt. Undantag: den ALLRA senaste, strax efter rotationen
      // — det är en klient som skickade två refresh samtidigt eller tappade
      // svaret, och då nekas bara anropet.
      const reused = await McpToken.findOne({
        oauthClientId: client.clientId,
        revokedAt: null,
        $or: [{ prevRefreshTokenHashes: presented }, { prevRefreshTokenHash: presented }]
      });
      if (reused) {
        const history = reused.prevRefreshTokenHashes || [];
        const justRotated = history[history.length - 1] === presented
          && reused.rotatedAt && now.getTime() - reused.rotatedAt.getTime() < REFRESH_GRACE_MS;
        if (!justRotated) {
          await McpToken.updateOne({ _id: reused._id, revokedAt: null }, { $set: { revokedAt: now } });
          console.warn('[mcp] refresh-token reuse detected — connection revoked', { tokenId: String(reused._id) });
        }
      }
      return oauthError(res, 400, 'invalid_grant', 'refresh token is invalid or revoked');
    }

    return oauthError(res, 400, 'unsupported_grant_type', 'only authorization_code and refresh_token are supported');
  } catch (err) {
    console.error('MCP OAuth token error:', err.message);
    return oauthError(res, 500, 'server_error', 'token request failed');
  }
});

// ── POST /revoke — RFC 7009 ──────────────────────────────────────────────────
router.post('/revoke', oauthLimiter, async (req, res) => {
  try {
    const client = await authenticateClient(req);
    if (!client) return oauthError(res, 401, 'invalid_client', 'client authentication failed');
    const { token } = req.body;
    // RFC 7009 §2.2: okänd/ogiltig token är ändå 200.
    if (typeof token === 'string' && token) {
      const hash = McpToken.hashToken(token);
      await McpToken.updateOne(
        {
          oauthClientId: client.clientId,
          revokedAt: null,
          $or: [{ tokenHash: hash }, { refreshTokenHash: hash }]
        },
        { $set: { revokedAt: new Date() } }
      );
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({});
  } catch (err) {
    console.error('MCP OAuth revoke error:', err.message);
    return oauthError(res, 500, 'server_error', 'revocation failed');
  }
});

module.exports = router;

// OAuth 2.1-hjälpare för MCP-connectorn — PKCE, scopes, metadata-dokument och
// token-mintning. Porterad från Cellarion (services/mcpOAuth.js). Ren logik
// utanför routen så den går att enhetstesta och routen förblir ett tunt skal.
//
// Standarder: OAuth 2.1 + RFC 8414 (AS-metadata) + RFC 9728 (protected-
// resource-metadata) + RFC 7591 (DCR) + RFC 7636 (PKCE) + RFC 8707 (resource).
const crypto = require('crypto');
const McpToken = require('../models/McpToken');
const OAuthAuthCode = require('../models/OAuthAuthCode');

// Access-tokens är kortlivade; klienten förnyar tyst. Refresh-token roteras vid
// varje användning och raden lever tills den återkallas, så anslutningen
// överlever access-tokenens utgång.
const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 timme

// Scopes en OAuth-token kan bära. offline_access är ett meta-scope som bara
// signalerar "ge mig en refresh-token" (det gör vi alltid) — det annonseras för
// kompatibilitet (claude.ai lägger till det) men lagras aldrig.
const GRANTABLE_SCOPES = McpToken.TOKEN_SCOPES; // ['read', 'write']
const SUPPORTED_SCOPES = [...GRANTABLE_SCOPES, 'offline_access'];

// En refresh-token som spelas upp igen strax efter rotationen är oftast en
// klient som skickade två refresh samtidigt eller tappade svaret — inte en
// stöld. Inom fönstret nekas den utan att anslutningen dör.
const REFRESH_GRACE_MS = 2 * 60 * 1000;
// Så många förbrukade refresh-tokens bakåt känns igen som återanvändning.
const REFRESH_HISTORY = 10;
// En anslutning som inte använts på 90 dagar somnar — godkänn på nytt.
const IDLE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;
// S256-challenge = base64url(SHA-256) = exakt 43 tecken.
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_STATE_LENGTH = 512;

// AI-tjänster vi känner igen på redirect-värden. Vem som helst kan registrera
// en klient (DCR är öppet), så samtyckessidan varnar för en okänd app, och
// protokollfel redirectas aldrig till en okänd värd (ingen öppen redirect).
// Fler: MCP_KNOWN_REDIRECT_HOSTS (kommaseparerad).
const KNOWN_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function knownRedirectHosts() {
  const extra = (process.env.MCP_KNOWN_REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...KNOWN_REDIRECT_HOSTS, ...extra];
}

/** 'known' (en AI-tjänst vi känner igen), 'local' (en app på datorn) eller 'unknown'. */
function redirectTrust(uri) {
  let u;
  try { u = new URL(uri); } catch { return 'unknown'; }
  const host = u.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.includes(host)) return 'local';
  if (u.protocol !== 'https:') return 'unknown';
  return knownRedirectHosts().some((h) => host === h || host.endsWith(`.${h}`)) ? 'known' : 'unknown';
}

/**
 * Originet som AS + RS serveras från (prod: https://glosan.app). FRONTEND_URL
 * kan vara kommaseparerad — första posten är den kanoniska, precis som för
 * Google-callbacken i routes/oauth.js.
 */
function issuer() {
  const first = (process.env.FRONTEND_URL || '').split(',')[0].trim();
  return (first || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Kanonisk RFC 8707-resource för MCP-endpointen (audience). */
function resourceUrl() {
  return `${issuer()}/api/mcp`;
}

const OAUTH_BASE = () => `${issuer()}/api/mcp/oauth`;

/** RFC 8414 — serveras på /.well-known/oauth-authorization-server. */
function authServerMetadata() {
  const base = OAUTH_BASE();
  return {
    issuer: issuer(),
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://github.com/jagduvi1/Glosan'
  };
}

/**
 * RFC 9728 — serveras på /.well-known/oauth-protected-resource/api/mcp.
 * `resource` MÅSTE vara URL:en användaren klistrar in i sin klient.
 */
function protectedResourceMetadata() {
  return {
    resource: resourceUrl(),
    authorization_servers: [issuer()],
    scopes_supported: SUPPORTED_SCOPES,
    resource_name: 'Glosan MCP',
    resource_documentation: 'https://github.com/jagduvi1/Glosan',
    bearer_methods_supported: ['header']
  };
}

/** base64url(SHA-256(input)) — S256-transformen (RFC 7636 §4.2). */
function s256(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

/**
 * Verifiera en PKCE code_verifier mot lagrad S256-challenge i konstant tid.
 * Verifiern måste vara 43–128 "unreserved"-tecken (RFC 7636 §4.1).
 */
function verifyPkce(codeVerifier, storedChallenge) {
  if (typeof codeVerifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
  if (typeof storedChallenge !== 'string' || !storedChallenge) return false;
  const a = Buffer.from(s256(codeVerifier));
  const b = Buffer.from(storedChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Tolka en OAuth `scope`-sträng till de scopes vi faktiskt ger. Okända scopes
 * släpps tyst (RFC 6749 §3.3 låter AS:en smalna av). Inget giltigt → 'read'
 * — en anslutning utan scope är oanvändbar och read är golvet.
 *
 * OBS: claude.ai skickar ofta INGET scope alls. Då blir erbjudandet bara
 * 'read', vilket skulle göra det omöjligt att skapa listor. Därför tolkas en
 * tom scope-sträng som "allt vi erbjuder" — användaren väljer ändå nivån själv
 * på samtyckessidan.
 */
function grantedScopes(scopeStr) {
  const requested = String(scopeStr || '').split(/\s+/).filter(Boolean);
  if (requested.length === 0 || requested.every((s) => s === 'offline_access')) {
    return [...GRANTABLE_SCOPES];
  }
  const granted = GRANTABLE_SCOPES.filter((s) => requested.includes(s));
  // write utan read vore en anslutning som kan ändra men inte se — write innebär read.
  if (granted.includes('write') && !granted.includes('read')) granted.unshift('read');
  return granted.length ? granted : ['read'];
}

/** Exakt strängmatch mot klientens registrerade redirect-URI:er (OAuth 2.1 §4.1.3). */
function redirectUriRegistered(client, redirectUri) {
  return Array.isArray(client?.redirectUris) && client.redirectUris.includes(redirectUri);
}

/**
 * Minta ett nytt access+refresh-par. Används både vid första kodväxlingen och
 * vid varje refresh. Returnerar { raw: { access, refresh }, fields, expiresAt }.
 */
function rotateCredentials() {
  const access = McpToken.generateToken();
  const refresh = McpToken.generateRefreshToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);
  return {
    raw: { access, refresh },
    fields: {
      tokenHash: McpToken.hashToken(access),
      refreshTokenHash: McpToken.hashToken(refresh),
      expiresAt
    },
    expiresAt
  };
}

/** Token-endpointens svar (RFC 6749 §5.1). */
function tokenResponse(rawAccess, rawRefresh, scopes) {
  return {
    access_token: rawAccess,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: rawRefresh,
    scope: scopes.join(' ')
  };
}

/**
 * Återkalla alla AI-anslutningar en användare har, och de auth-koder som ännu
 * inte växlats. Anropas vid lösenordsåterställning: en phishad anslutning är
 * en tredjepartsbehörighet, och "säkra mitt konto"-reflexen måste avsluta den —
 * samma gräns som redan gäller för inloggningssessionerna. Returnerar antalet
 * återkallade anslutningar.
 */
async function revokeMcpConnectionsForUser(userId) {
  const res = await McpToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  await OAuthAuthCode.deleteMany({ user: userId });
  return res.modifiedCount || 0;
}

module.exports = {
  ACCESS_TOKEN_TTL_SEC,
  GRANTABLE_SCOPES,
  SUPPORTED_SCOPES,
  REFRESH_GRACE_MS,
  REFRESH_HISTORY,
  IDLE_EXPIRY_MS,
  CODE_CHALLENGE_RE,
  MAX_STATE_LENGTH,
  redirectTrust,
  issuer,
  resourceUrl,
  authServerMetadata,
  protectedResourceMetadata,
  s256,
  verifyPkce,
  grantedScopes,
  redirectUriRegistered,
  rotateCredentials,
  tokenResponse,
  revokeMcpConnectionsForUser
};

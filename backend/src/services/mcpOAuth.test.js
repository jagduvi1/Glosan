/**
 * Enhetstester för MCP-OAuth-hjälparna: PKCE, scope-tolkning, issuer och
 * discovery-dokumenten. Rena funktioner — ingen databas.
 */
const crypto = require('crypto');
const {
  s256, verifyPkce, grantedScopes, redirectUriRegistered, issuer, resourceUrl,
  authServerMetadata, protectedResourceMetadata, tokenResponse, rotateCredentials
} = require('./mcpOAuth');

const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;
afterEach(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
});

describe('PKCE (S256)', () => {
  // RFC 7636 appendix B:s testvektor.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  test('s256 matches the RFC 7636 test vector', () => {
    expect(s256(verifier)).toBe(challenge);
  });

  test('accepts the matching verifier', () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  test('rejects a wrong verifier, a malformed verifier and a missing challenge', () => {
    const other = crypto.randomBytes(32).toString('base64url');
    expect(verifyPkce(other, challenge)).toBe(false);
    expect(verifyPkce('too-short', challenge)).toBe(false);
    expect(verifyPkce(`${verifier}!`, challenge)).toBe(false);
    expect(verifyPkce(verifier, '')).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    expect(verifyPkce({ $ne: null }, challenge)).toBe(false);
  });
});

describe('grantedScopes', () => {
  test('an empty or offline_access-only request offers everything (the consent page narrows)', () => {
    expect(grantedScopes('')).toEqual(['read', 'write']);
    expect(grantedScopes(undefined)).toEqual(['read', 'write']);
    expect(grantedScopes('offline_access')).toEqual(['read', 'write']);
  });

  test('intersects with what we can grant, in canonical order', () => {
    expect(grantedScopes('write read offline_access')).toEqual(['read', 'write']);
    expect(grantedScopes('read')).toEqual(['read']);
    expect(grantedScopes('read admin')).toEqual(['read']);
  });

  test('only unknown scopes falls back to the read floor', () => {
    expect(grantedScopes('admin profile')).toEqual(['read']);
  });
});

describe('redirectUriRegistered', () => {
  const client = { redirectUris: ['https://claude.ai/api/mcp/auth_callback'] };

  test('exact match only', () => {
    expect(redirectUriRegistered(client, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriRegistered(client, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectUriRegistered(client, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(redirectUriRegistered(client, 'https://evil.example/api/mcp/auth_callback')).toBe(false);
    expect(redirectUriRegistered(null, 'https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });
});

describe('issuer + discovery documents', () => {
  test('uses the FIRST entry of a comma-separated FRONTEND_URL, without trailing slash', () => {
    process.env.FRONTEND_URL = 'https://glosan.app/, https://glosan.jeklund.dev';
    expect(issuer()).toBe('https://glosan.app');
    expect(resourceUrl()).toBe('https://glosan.app/api/mcp');
  });

  test('AS metadata advertises only S256 PKCE and the two grants', () => {
    process.env.FRONTEND_URL = 'https://glosan.app';
    const meta = authServerMetadata();
    expect(meta.issuer).toBe('https://glosan.app');
    expect(meta.authorization_endpoint).toBe('https://glosan.app/api/mcp/oauth/authorize');
    expect(meta.token_endpoint).toBe('https://glosan.app/api/mcp/oauth/token');
    expect(meta.registration_endpoint).toBe('https://glosan.app/api/mcp/oauth/register');
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
  });

  test('protected-resource metadata points at the issuer', () => {
    process.env.FRONTEND_URL = 'https://glosan.app';
    const prm = protectedResourceMetadata();
    expect(prm.resource).toBe('https://glosan.app/api/mcp');
    expect(prm.authorization_servers).toEqual(['https://glosan.app']);
  });
});

describe('credentials', () => {
  test('rotateCredentials mints a glo_ access token and stores only hashes', () => {
    const cred = rotateCredentials();
    expect(cred.raw.access).toMatch(/^glo_[a-f0-9]{64}$/);
    expect(cred.raw.refresh).toMatch(/^[a-f0-9]{64}$/);
    expect(cred.fields.tokenHash).not.toContain(cred.raw.access);
    expect(cred.fields.tokenHash).toHaveLength(64);
    expect(cred.fields.refreshTokenHash).toHaveLength(64);
    expect(cred.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('tokenResponse has the RFC 6749 shape', () => {
    expect(tokenResponse('glo_a', 'r', ['read', 'write'])).toEqual({
      access_token: 'glo_a', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', scope: 'read write'
    });
  });
});

/**
 * Tester för MCP-connectorns OAuth 2.1-server (routes/mcpOAuth.js) och för
 * hur /api/mcp tar emot tokens (middleware/mcpAuth.js + routes/mcp.js).
 *
 * Hela flödet körs: registrering → authorize → samtycke → kodväxling →
 * refresh-rotation (inkl. återanvändningsdetektion) → återkallning. Det är
 * säkerhetskritiskt — ett fel här betyder läckta koder, öppna redirects eller
 * tokens som inte går att döda — så kontraktet pinnas här.
 *
 * Sviten har ingen Mongo, så modellerna ersätts av små in-memory-fejkar som
 * stödjer exakt de query-former routerna använder.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://glosan.test';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// In-memory-fejk av en Mongoose-modell: equality, null, $gt, $ne och $or i
// filter; $set/$unset i uppdateringar. Dokumenten är vanliga objekt med en
// no-op save() — mutationer före save() landar direkt i "databasen".
function mockMakeModel(prefix, statics = {}) {
  const docs = [];
  let seq = 0;
  const isOp = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
  const matches = (doc, q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(doc, sub));
    const actual = doc[k];
    if (Array.isArray(actual) && !isOp(v)) return actual.map(String).includes(String(v));
    if (isOp(v) && '$gt' in v) return actual != null && actual > v.$gt;
    if (isOp(v) && '$ne' in v) return String(actual) !== String(v.$ne);
    if (isOp(v) && '$exists' in v) return v.$exists ? actual !== undefined : actual === undefined;
    if (v === null) return actual == null;
    return String(actual) === String(v);
  });
  const apply = (doc, upd) => {
    Object.assign(doc, upd.$set || {});
    for (const k of Object.keys(upd.$unset || {})) delete doc[k];
    for (const [k, p] of Object.entries(upd.$push || {})) {
      const next = [...(doc[k] || []), ...(p.$each || [p])];
      doc[k] = p.$slice !== undefined ? next.slice(p.$slice) : next;
    }
  };
  const store = (d) => {
    const doc = { _id: `${prefix}${String(++seq).padStart(24 - prefix.length, '0')}`, createdAt: new Date(), ...d };
    Object.defineProperty(doc, 'save', { value: async () => doc, enumerable: false });
    docs.push(doc);
    return doc;
  };
  return {
    _docs: docs,
    _reset: () => { docs.length = 0; },
    create: async (d) => store(d),
    findOne: async (q) => docs.find((d) => matches(d, q)) || null,
    countDocuments: async (q) => docs.filter((d) => matches(d, q)).length,
    findOneAndUpdate: async (q, upd, opts = {}) => {
      const doc = docs.find((d) => matches(d, q));
      if (!doc) return null;
      const before = { ...doc };
      apply(doc, upd);
      return opts.new ? doc : before;
    },
    updateOne: async (q, upd) => {
      const doc = docs.find((d) => matches(d, q));
      if (doc) apply(doc, upd);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    updateMany: async (q, upd) => {
      const hits = docs.filter((d) => matches(d, q));
      hits.forEach((d) => apply(d, upd));
      return { matchedCount: hits.length, modifiedCount: hits.length };
    },
    find: (q) => {
      const hits = docs.filter((d) => matches(d, q));
      const chain = { sort: () => chain, lean: async () => hits.map((d) => ({ ...d })) };
      return chain;
    },
    ...statics
  };
}

jest.mock('../models/OAuthClient', () => {
  const c = require('crypto');
  return mockMakeModel('c', {
    generateClientId: () => 'mcpc_' + c.randomBytes(24).toString('hex'),
    generateClientSecret: () => c.randomBytes(32).toString('hex'),
    hashSecret: (raw) => c.createHash('sha256').update(raw).digest('hex')
  });
});

jest.mock('../models/OAuthAuthCode', () => {
  const c = require('crypto');
  return mockMakeModel('a', {
    AUTH_CODE_TTL_MS: 5 * 60 * 1000,
    generateCode: () => c.randomBytes(32).toString('hex'),
    hashCode: (raw) => c.createHash('sha256').update(raw).digest('hex')
  });
});

jest.mock('../models/McpToken', () => {
  const c = require('crypto');
  return mockMakeModel('b', {
    TOKEN_PREFIX: 'glo_',
    TOKEN_SCOPES: ['read', 'write'],
    hashToken: (raw) => c.createHash('sha256').update(raw).digest('hex'),
    generateToken: () => 'glo_' + c.randomBytes(32).toString('hex'),
    generateRefreshToken: () => c.randomBytes(32).toString('hex')
  });
});

const mockCredentialsChangedAt = new Map();
const mockFeatures = new Map();
jest.mock('../models/User', () => {
  const doc = (id) => (String(id) === 'deleted-user' ? null
    : { _id: id, roles: ['user'], credentialsChangedAt: mockCredentialsChangedAt.get(String(id)) || null, features: mockFeatures.get(String(id)) || [] });
  return {
    findById: (id) => ({
      select: () => ({ lean: async () => doc(id) }),
      lean: async () => doc(id)
    })
  };
});

// /api/mcp-routen ska här bara testa auth-lagret — själva MCP-servern (som
// laddar ESM-SDK:t) ersätts av en stub som visar vilken ctx den fick.
jest.mock('../mcp/server', () => ({
  handleMcpRequest: async (req, res, ctx) => res.json({ reached: true, userId: ctx.user.id, scopes: ctx.scopes, features: ctx.features })
}));

const OAuthClient = require('../models/OAuthClient');
const OAuthAuthCode = require('../models/OAuthAuthCode');
const McpToken = require('../models/McpToken');
const mcpOAuthRoute = require('./mcpOAuth');

// Modulreglerna prövas med Plugga som en modul som INTE är släppt, så varje
// konto styrs av mockFeatures. Att släppet följer samma regler prövas för sig
// (se "a module released after connecting …" nedan).
const { FEATURES } = require('../config/features');
const studyReleased = FEATURES.study.released;
beforeAll(() => { FEATURES.study.released = false; });
afterAll(() => { FEATURES.study.released = studyReleased; });
const mcpRoute = require('./mcp');

const app = express();
app.use(express.json());
app.use('/api/mcp/oauth', mcpOAuthRoute);
app.use('/api/mcp', mcpRoute);

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const USER_ID = '64b000000000000000000001';
const jwtFor = (id = USER_ID) => jwt.sign({ id, roles: ['user'] }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });

const pkcePair = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

async function registerClient(body = {}) {
  const res = await request(app).post('/api/mcp/oauth/register').send({
    client_name: 'Claude', redirect_uris: [CALLBACK], ...body
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function approve(clientId, challenge, extra = {}) {
  return request(app)
    .post('/api/mcp/oauth/approve')
    .set('Authorization', `Bearer ${jwtFor()}`)
    .send({
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'read write',
      state: 'st4te',
      approved: true,
      ...extra
    });
}

const codeFrom = (redirect) => new URL(redirect).searchParams.get('code');

async function exchange(clientId, code, verifier) {
  return request(app).post('/api/mcp/oauth/token').type('form').send({
    grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK
  });
}

/** Hela vägen fram till ett tokenpar. */
async function connect(scopes) {
  const client = await registerClient();
  const { verifier, challenge } = pkcePair();
  const ap = await approve(client.client_id, challenge, scopes ? { scopes } : {});
  const tok = await exchange(client.client_id, codeFrom(ap.body.redirect), verifier);
  expect(tok.status).toBe(200);
  return { client, tokens: tok.body };
}

beforeEach(() => {
  OAuthClient._reset();
  OAuthAuthCode._reset();
  McpToken._reset();
  mockCredentialsChangedAt.clear();
  mockFeatures.clear();
});

describe('POST /register', () => {
  test('registers a public client with an https callback', async () => {
    const body = await registerClient();
    expect(body.client_id).toMatch(/^mcpc_/);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.client_secret).toBeUndefined();
  });

  test('rejects non-https (non-loopback) and malformed redirect URIs', async () => {
    for (const uris of [['http://evil.example/cb'], ['javascript:alert(1)'], [], 'https://x.test', ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test', 'https://e.test', 'https://f.test']]) {
      const res = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: uris });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_redirect_uri');
    }
  });

  test('allows http on loopback for native clients', async () => {
    const res = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: ['http://127.0.0.1:33418/callback'] });
    expect(res.status).toBe(201);
  });

  test('rejects an auth method the token endpoint cannot verify', async () => {
    const res = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' });
    expect(res.status).toBe(400);
  });
});

describe('GET /authorize', () => {
  test('unknown client or unregistered redirect_uri → plain 400, never a redirect', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const unknown = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: 'mcpc_nope', redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256'
    });
    expect(unknown.status).toBe(400);
    const wrongUri = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256'
    });
    expect(wrongUri.status).toBe(400);
    expect(wrongUri.headers.location).toBeUndefined();
  });

  test('a browser with an unknown client (e.g. Claude\'s published identity) gets a page saying what to do', async () => {
    const { challenge } = pkcePair();
    const res = await request(app).get('/api/mcp/oauth/authorize').set('Accept', 'text/html,application/xhtml+xml,*/*;q=0.8').query({
      client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256'
    });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Register automatically');
    expect(res.text).toContain('https://glosan.test/koppla-ai');
  });

  test('missing PKCE → error redirected back to the (validated) client with state', async () => {
    const client = await registerClient();
    const res = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', state: 'abc'
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.origin + loc.pathname).toBe(CALLBACK);
    expect(loc.searchParams.get('error')).toBe('invalid_request');
    expect(loc.searchParams.get('state')).toBe('abc');
  });

  test('a valid request is handed to the consent page with its parameters', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const res = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', scope: 'read write', state: 'xyz',
      resource: 'https://glosan.test/api/mcp'
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.origin + loc.pathname).toBe('https://glosan.test/connect-ai/authorize');
    expect(loc.searchParams.get('client_id')).toBe(client.client_id);
    expect(loc.searchParams.get('code_challenge')).toBe(challenge);
    expect(loc.searchParams.get('state')).toBe('xyz');
    expect(loc.searchParams.get('client_name')).toBeNull();
  });

  test('errors never redirect to a host we do not know — no open redirect (audit)', async () => {
    const client = await registerClient({ redirect_uris: ['https://evil.example/cb'] });
    const res = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'token', state: 'abc'
    });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  test('a malformed code_challenge or an overlong state is refused (audit)', async () => {
    const client = await registerClient();
    const shortChallenge = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'abc', code_challenge_method: 'S256'
    });
    expect(new URL(shortChallenge.headers.location).searchParams.get('error')).toBe('invalid_request');
    const { challenge } = pkcePair();
    const longState = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'x'.repeat(513)
    });
    expect(longState.status).toBe(400);
  });

  test('a foreign resource indicator is refused', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const res = await request(app).get('/api/mcp/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://other.example/api/mcp'
    });
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('GET /client', () => {
  test('tells the consent page who is asking, and whether we know the host (audit)', async () => {
    const known = await registerClient();
    const k = await request(app).get('/api/mcp/oauth/client').query({ client_id: known.client_id, redirect_uri: CALLBACK });
    expect(k.body).toEqual({ client_name: 'Claude', redirect_host: 'claude.ai', trust: 'known' });
    const fake = await registerClient({ client_name: 'Claude', redirect_uris: ['https://claude-ai.example/cb'] });
    const f = await request(app).get('/api/mcp/oauth/client').query({ client_id: fake.client_id, redirect_uri: 'https://claude-ai.example/cb' });
    expect(f.body.trust).toBe('unknown');
    const local = await registerClient({ redirect_uris: ['http://127.0.0.1:33418/callback'] });
    const l = await request(app).get('/api/mcp/oauth/client').query({ client_id: local.client_id, redirect_uri: 'http://127.0.0.1:33418/callback' });
    expect(l.body.trust).toBe('local');
    const wrong = await request(app).get('/api/mcp/oauth/client').query({ client_id: known.client_id, redirect_uri: 'https://evil.example/cb' });
    expect(wrong.status).toBe(404);
  });
});

describe('POST /approve', () => {
  test('requires a logged-in user (JWT), and never accepts an MCP token', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const anon = await request(app).post('/api/mcp/oauth/approve').send({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', approved: true });
    expect(anon.status).toBe(401);
    const { tokens } = await connect();
    const viaToken = await request(app).post('/api/mcp/oauth/approve')
      .set('Authorization', `Bearer ${tokens.access_token}`)
      .send({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', approved: true });
    expect(viaToken.status).toBe(401);
  });

  test('deny → access_denied back to the client, no code minted', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const res = await approve(client.client_id, challenge, { approved: false });
    const loc = new URL(res.body.redirect);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st4te');
    expect(loc.searchParams.get('code')).toBeNull();
    expect(OAuthAuthCode._docs).toHaveLength(0);
  });

  test('re-validates redirect_uri server-side and blocks operator injection', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    expect((await approve(client.client_id, challenge, { redirect_uri: 'https://evil.example/cb' })).status).toBe(400);
    expect((await approve({ $ne: null }, challenge)).status).toBe(400);
  });

  test('the user may narrow scopes but never widen them, and read is required', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    expect((await approve(client.client_id, challenge, { scope: 'read', scopes: ['read', 'write'] })).status).toBe(400);
    expect((await approve(client.client_id, challenge, { scopes: ['write'] })).status).toBe(400);
    const narrowed = await approve(client.client_id, challenge, { scopes: ['read'] });
    expect(narrowed.status).toBe(200);
    expect(OAuthAuthCode._docs[0].scopes).toEqual(['read']);
    // Den lagrade koden är en hash, aldrig klartexten i redirecten.
    expect(OAuthAuthCode._docs[0].codeHash).not.toBe(codeFrom(narrowed.body.redirect));
  });

  test('a client asking only for write gets read too (audit)', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    expect((await approve(client.client_id, challenge, { scope: 'write' })).status).toBe(200);
    expect(OAuthAuthCode._docs[0].scopes).toEqual(['read', 'write']);
  });

  test('a login from before a password reset cannot connect an AI (audit)', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const oldJwt = jwt.sign({ id: USER_ID, roles: ['user'], iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
    mockCredentialsChangedAt.set(USER_ID, new Date(Date.now() - 10 * 1000));
    const res = await request(app).post('/api/mcp/oauth/approve').set('Authorization', `Bearer ${oldJwt}`).send({
      client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', approved: true
    });
    expect(res.status).toBe(401);
    // En ny inloggning efter bytet går bra.
    expect((await approve(client.client_id, challenge)).status).toBe(200);
  });
});

describe('POST /token — authorization_code', () => {
  test('exchanges a code for a glo_ access token + refresh token', async () => {
    const { tokens } = await connect();
    expect(tokens.access_token).toMatch(/^glo_/);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.scope).toBe('read write');
    expect(McpToken._docs).toHaveLength(1);
    expect(McpToken._docs[0].tokenHash).not.toBe(tokens.access_token);
    // Klienten har använts → städ-TTL:en är borta.
    expect(OAuthClient._docs[0].expiresAt).toBeUndefined();
  });

  test('a wrong PKCE verifier is invalid_grant — and the code is burned', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom((await approve(client.client_id, challenge)).body.redirect);
    const bad = await exchange(client.client_id, code, pkcePair().verifier);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_grant');
    expect((await exchange(client.client_id, code, verifier)).status).toBe(400);
  });

  test('codes are single-use', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom((await approve(client.client_id, challenge)).body.redirect);
    expect((await exchange(client.client_id, code, verifier)).status).toBe(200);
    const replay = await exchange(client.client_id, code, verifier);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  test('a code issued to one client cannot be redeemed by another', async () => {
    const a = await registerClient();
    const b = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom((await approve(a.client_id, challenge)).body.redirect);
    const res = await exchange(b.client_id, code, verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('a code minted before a password reset is dead (audit)', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom((await approve(client.client_id, challenge)).body.redirect);
    OAuthAuthCode._docs[0].createdAt = new Date(Date.now() - 60 * 1000);
    mockCredentialsChangedAt.set(USER_ID, new Date(Date.now() - 1000));
    const res = await exchange(client.client_id, code, verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('an expired code is rejected', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom((await approve(client.client_id, challenge)).body.redirect);
    OAuthAuthCode._docs[0].expiresAt = new Date(Date.now() - 1000);
    expect((await exchange(client.client_id, code, verifier)).status).toBe(400);
  });

  test('unknown client → invalid_client (401)', async () => {
    const res = await exchange('mcpc_nope', 'x', 'y');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });
});

describe('POST /token — refresh_token', () => {
  const refresh = (clientId, token) => request(app).post('/api/mcp/oauth/token').type('form')
    .send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token });

  test('rotates both tokens; the old access token stops working', async () => {
    const { client, tokens } = await connect();
    const res = await refresh(client.client_id, tokens.refresh_token);
    expect(res.status).toBe(200);
    expect(res.body.access_token).not.toBe(tokens.access_token);
    expect(res.body.refresh_token).not.toBe(tokens.refresh_token);
    const old = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({});
    expect(old.status).toBe(401);
    const fresh = await request(app).post('/api/mcp').set('Authorization', `Bearer ${res.body.access_token}`).send({});
    expect(fresh.status).toBe(200);
  });

  test('replaying a spent refresh token revokes the whole connection (reuse detection)', async () => {
    const { client, tokens } = await connect();
    const rotated = await refresh(client.client_id, tokens.refresh_token);
    // Efter nådfönstret (två samtidiga refresh:ar / ett tappat svar) = stöld.
    McpToken._docs[0].rotatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const replay = await refresh(client.client_id, tokens.refresh_token);
    warn.mockRestore();
    expect(replay.status).toBe(400);
    expect(McpToken._docs[0].revokedAt).toBeInstanceOf(Date);
    // Även den legitima efterträdaren är nu död — båda måste godkänna igen.
    expect((await refresh(client.client_id, rotated.body.refresh_token)).status).toBe(400);
  });

  test('right after a rotation the old token is refused without killing the connection (audit)', async () => {
    const { client, tokens } = await connect();
    const rotated = await refresh(client.client_id, tokens.refresh_token);
    const again = await refresh(client.client_id, tokens.refresh_token);
    expect(again.status).toBe(400);
    expect(McpToken._docs[0].revokedAt).toBeFalsy();
    expect((await refresh(client.client_id, rotated.body.refresh_token)).status).toBe(200);
  });

  test('a token from several rotations back is recognised as reuse (audit)', async () => {
    const { client, tokens } = await connect();
    let current = tokens.refresh_token;
    for (let i = 0; i < 3; i++) current = (await refresh(client.client_id, current)).body.refresh_token;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const replay = await refresh(client.client_id, tokens.refresh_token);
    warn.mockRestore();
    expect(replay.status).toBe(400);
    expect(McpToken._docs[0].revokedAt).toBeInstanceOf(Date);
  });

  test('a connection unused for 90 days has fallen asleep (audit)', async () => {
    const { client, tokens } = await connect();
    const longAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    Object.assign(McpToken._docs[0], { createdAt: longAgo, lastUsedAt: longAgo, rotatedAt: null });
    const res = await refresh(client.client_id, tokens.refresh_token);
    expect(res.status).toBe(400);
    expect(McpToken._docs[0].revokedAt).toBeInstanceOf(Date);
  });

  test('another client cannot use the refresh token', async () => {
    const { tokens } = await connect();
    const other = await registerClient();
    expect((await refresh(other.client_id, tokens.refresh_token)).status).toBe(400);
  });
});

describe('POST /api/mcp', () => {
  test('JSON-RPC batches are refused (audit)', async () => {
    const { tokens } = await connect();
    const res = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`)
      .send([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
  });
});

describe('modules (audit: a connection never widens by itself)', () => {
  const mcpCall = (token) => request(app).post('/api/mcp').set('Authorization', `Bearer ${token}`)
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  test('a module switched on after connecting stays out until the user connects again', async () => {
    const first = await connect();
    expect(McpToken._docs[0].modules).toEqual([]);
    mockFeatures.set(USER_ID, ['study']);
    expect((await mcpCall(first.tokens.access_token)).body.features).toEqual([]);
    const list = await request(app).get('/api/mcp/connections').set('Authorization', `Bearer ${jwtFor()}`);
    expect(list.body.connections[0].missingModules).toEqual([{ key: 'study', label: 'Plugga' }]);

    const second = await connect();
    expect((await mcpCall(second.tokens.access_token)).body.features).toEqual(['study']);
    // Och en modul som slås AV når inte heller anslutningen som godkände den.
    mockFeatures.set(USER_ID, []);
    expect((await mcpCall(second.tokens.access_token)).body.features).toEqual([]);
  });

  test('a module released after connecting reaches new connections only (v0.1.39: Plugga for everyone)', async () => {
    const before = await connect();
    expect(McpToken._docs[0].modules).toEqual([]);
    FEATURES.study.released = true;
    try {
      // Släppt är inte detsamma som godkänt: den gamla anslutningen når det inte.
      expect((await mcpCall(before.tokens.access_token)).body.features).toEqual([]);
      const list = await request(app).get('/api/mcp/connections').set('Authorization', `Bearer ${jwtFor()}`);
      expect(list.body.connections[0].missingModules).toEqual([{ key: 'study', label: 'Plugga' }]);
      const after = await connect();
      expect((await mcpCall(after.tokens.access_token)).body.features).toEqual(['study']);
    } finally {
      FEATURES.study.released = false;
    }
  });

  test('a connection from before the field never gains a module released later — unless the account had it', async () => {
    const { tokens } = await connect();
    delete McpToken._docs[0].modules;
    FEATURES.study.released = true;
    try {
      const list = await request(app).get('/api/mcp/connections').set('Authorization', `Bearer ${jwtFor()}`);
      expect(list.body.connections[0].missingModules).toEqual([{ key: 'study', label: 'Plugga' }]);
      expect((await mcpCall(tokens.access_token)).body.features).toEqual([]);
      await new Promise((r) => setImmediate(r));
      expect(McpToken._docs[0].modules).toEqual([]);
      // Hade kontot Plugga själv (före släppet) räknas det som förut.
      delete McpToken._docs[0].modules;
      mockFeatures.set(USER_ID, ['study']);
      expect((await mcpCall(tokens.access_token)).body.features).toEqual(['study']);
    } finally {
      FEATURES.study.released = false;
    }
  });

  test('a connection from before the field is frozen to what it reaches on first use', async () => {
    const { tokens } = await connect();
    delete McpToken._docs[0].modules;
    mockFeatures.set(USER_ID, ['study']);
    expect((await mcpCall(tokens.access_token)).body.features).toEqual(['study']);
    await new Promise((r) => setImmediate(r));
    expect(McpToken._docs[0].modules).toEqual(['study']);
  });

  test("the user's own JWT (MCP Inspector) gets every module the account has", async () => {
    mockFeatures.set(USER_ID, ['study']);
    expect((await mcpCall(jwtFor())).body.features).toEqual(['study']);
  });
});

describe('POST /revoke', () => {
  test('revokes the connection; unknown tokens are still 200 (RFC 7009)', async () => {
    const { client, tokens } = await connect();
    const unknown = await request(app).post('/api/mcp/oauth/revoke').type('form').send({ client_id: client.client_id, token: 'nope' });
    expect(unknown.status).toBe(200);
    const res = await request(app).post('/api/mcp/oauth/revoke').type('form').send({ client_id: client.client_id, token: tokens.refresh_token });
    expect(res.status).toBe(200);
    const after = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({});
    expect(after.status).toBe(401);
  });
});

describe('/api/mcp auth', () => {
  test('no credential → 401 with the RFC 9728 discovery pointer', async () => {
    const res = await request(app).post('/api/mcp').send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://glosan.test/.well-known/oauth-protected-resource/api/mcp", scope="read write"'
    );
  });

  test('a valid token reaches the MCP server with exactly its granted scopes', async () => {
    const { tokens } = await connect(['read']);
    const res = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true, userId: USER_ID, scopes: ['read'], features: [] });
  });

  test('an expired access token → 401 so the client refreshes', async () => {
    const { tokens } = await connect();
    McpToken._docs[0].expiresAt = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
  });

  test('a token whose account is gone is dead', async () => {
    const { tokens } = await connect();
    McpToken._docs[0].user = 'deleted-user';
    expect((await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({})).status).toBe(401);
  });

  test('the user\'s own JWT works too, with full scopes', async () => {
    const res = await request(app).post('/api/mcp').set('Authorization', `Bearer ${jwtFor()}`).send({});
    expect(res.body.scopes).toEqual(['read', 'write']);
  });

  test('GET is 405 for an authenticated caller (stateless server)', async () => {
    const res = await request(app).get('/api/mcp').set('Authorization', `Bearer ${jwtFor()}`);
    expect(res.status).toBe(405);
  });
});

describe('connections (profile page)', () => {
  test('lists and revokes the user\'s own connections — JWT only', async () => {
    const { tokens } = await connect();
    const viaToken = await request(app).get('/api/mcp/connections').set('Authorization', `Bearer ${tokens.access_token}`);
    expect(viaToken.status).toBe(401);

    const list = await request(app).get('/api/mcp/connections').set('Authorization', `Bearer ${jwtFor()}`);
    expect(list.status).toBe(200);
    expect(list.body.endpoint).toBe('https://glosan.test/api/mcp');
    expect(list.body.connections).toHaveLength(1);
    expect(list.body.connections[0]).not.toHaveProperty('tokenHash');

    const otherUser = await request(app).delete(`/api/mcp/connections/${list.body.connections[0].id}`)
      .set('Authorization', `Bearer ${jwtFor('64b000000000000000000999')}`);
    expect(otherUser.status).toBe(404);

    const del = await request(app).delete(`/api/mcp/connections/${list.body.connections[0].id}`).set('Authorization', `Bearer ${jwtFor()}`);
    expect(del.status).toBe(200);
    const after = await request(app).post('/api/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({});
    expect(after.status).toBe(401);
  });
});

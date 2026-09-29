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
    if (isOp(v) && '$gt' in v) return actual != null && actual > v.$gt;
    if (isOp(v) && '$ne' in v) return String(actual) !== String(v.$ne);
    if (v === null) return actual == null;
    return String(actual) === String(v);
  });
  const apply = (doc, upd) => {
    Object.assign(doc, upd.$set || {});
    for (const k of Object.keys(upd.$unset || {})) delete doc[k];
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

jest.mock('../models/User', () => ({
  findById: (id) => ({
    select: () => ({
      lean: async () => (String(id) === 'deleted-user' ? null : { _id: id, roles: ['user'] })
    })
  })
}));

// /api/mcp-routen ska här bara testa auth-lagret — själva MCP-servern (som
// laddar ESM-SDK:t) ersätts av en stub som visar vilken ctx den fick.
jest.mock('../mcp/server', () => ({
  handleMcpRequest: async (req, res, ctx) => res.json({ reached: true, userId: ctx.user.id, scopes: ctx.scopes })
}));

const OAuthClient = require('../models/OAuthClient');
const OAuthAuthCode = require('../models/OAuthAuthCode');
const McpToken = require('../models/McpToken');
const mcpOAuthRoute = require('./mcpOAuth');
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
    expect(loc.searchParams.get('client_name')).toBe('Claude');
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
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const replay = await refresh(client.client_id, tokens.refresh_token);
    warn.mockRestore();
    expect(replay.status).toBe(400);
    expect(McpToken._docs[0].revokedAt).toBeInstanceOf(Date);
    // Även den legitima efterträdaren är nu död — båda måste godkänna igen.
    expect((await refresh(client.client_id, rotated.body.refresh_token)).status).toBe(400);
  });

  test('another client cannot use the refresh token', async () => {
    const { tokens } = await connect();
    const other = await registerClient();
    expect((await refresh(other.client_id, tokens.refresh_token)).status).toBe(400);
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
    expect(res.body).toEqual({ reached: true, userId: USER_ID, scopes: ['read'] });
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

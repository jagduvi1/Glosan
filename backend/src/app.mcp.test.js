/**
 * Monteringsordningen i app.js för MCP-endpointsen. glosor-routern kör
 * router.use(requireAuth) på hela /api-prefixet, så en MCP-route monterad
 * EFTER den får ett 401 ("No token provided") på varje OAuth-anrop och varje
 * glo_-token innan den ens nås. routes/mcpOAuth.test.js monterar routrarna
 * isolerat och kan inte se det — därför testas den riktiga appen här.
 *
 * Inga DB-anrop behövs: varje fråga nedan besvaras innan någon modell rörs.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://glosan.test';

const request = require('supertest');
const app = require('./app');

describe('MCP routes are reachable through the real app', () => {
  test('discovery documents are served at the origin root', async () => {
    const prm = await request(app).get('/.well-known/oauth-protected-resource/api/mcp');
    expect(prm.status).toBe(200);
    expect(prm.body.resource).toBe('https://glosan.test/api/mcp');
    const as = await request(app).get('/.well-known/oauth-authorization-server');
    expect(as.body.token_endpoint).toBe('https://glosan.test/api/mcp/oauth/token');
  });

  test('an unauthenticated /api/mcp call gets the MCP challenge, not the generic 401', async () => {
    const res = await request(app).post('/api/mcp').send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata="https:\/\/glosan\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  });

  test('the OAuth endpoints are public (no JWT demanded by another router)', async () => {
    const reg = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: ['http://evil.example/cb'] });
    expect(reg.status).toBe(400);
    expect(reg.body.error).toBe('invalid_redirect_uri');
    const token = await request(app).post('/api/mcp/oauth/token').type('form').send({ grant_type: 'refresh_token' });
    expect(token.status).toBe(401);
    expect(token.body.error).toBe('invalid_client');
  });
});

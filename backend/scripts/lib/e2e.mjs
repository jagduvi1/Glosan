// Delade hjälpare för end-to-end-skripten (scripts/*-e2e.mjs): HTTP-anrop mot
// en KÖRANDE Glosan, engångsanvändare och en riktig MCP-klient via OAuth.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CALLBACK = 'https://example.test/callback';

export function e2e(baseArg) {
  const BASE = (baseArg || 'http://localhost:8080').replace(/\/+$/, '');
  let step = 0;
  const ok = (msg) => console.log(`  ✓ ${String(++step).padStart(2)} ${msg}`);

  async function api(path, token, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: data };
  }

  async function register(prefix) {
    const u = `${prefix}${crypto.randomBytes(3).toString('hex')}`;
    const r = await api('/api/auth/register', null, {
      method: 'POST', body: { username: u, email: `${u}@example.test`, password: 'E2e-Passw0rd!x', ageConsent: true }
    });
    assert.equal(r.status, 201, `register ${u}: ${JSON.stringify(r.body)}`);
    const me = await api('/api/auth/me', r.body.token);
    return { name: u, token: r.body.token, id: me.body.user._id || me.body.user.id };
  }

  async function connectMcp(jwt) {
    const reg = await api('/api/mcp/oauth/register', null, { method: 'POST', body: { client_name: 'E2E', redirect_uris: [CALLBACK] } });
    const clientId = reg.body.client_id;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const approve = await api('/api/mcp/oauth/approve', jwt, {
      method: 'POST',
      body: { client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', scope: 'read write', approved: true }
    });
    const code = new URL(approve.body.redirect).searchParams.get('code');
    const tok = await fetch(`${BASE}/api/mcp/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK })
    }).then((r) => r.json());
    const client = new Client({ name: 'glosan-e2e', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } }
    }));
    return client;
  }

  async function call(client, name, args = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text || '';
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { isError: !!res.isError, ...body };
  }

  return { BASE, ok, api, register, connectMcp, call };
}

/**
 * Slå på en funktionsflagga direkt i den lokala databasen (docker compose-
 * stacken) — för att testa en dold modul när FEATURES_FOR_ALL inte är satt.
 */
export function grantFeatureInLocalDb(username, feature, container = 'glosan-mongo') {
  execFileSync('docker', [
    'exec', container, 'mongosh', '--quiet', 'glosan', '--eval',
    `db.users.updateOne({ username: ${JSON.stringify(username.toLowerCase())} }, { $addToSet: { features: ${JSON.stringify(feature)} } })`
  ], { stdio: 'pipe' });
}

export const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

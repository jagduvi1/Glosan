// Delade hjälpare för end-to-end-skripten (scripts/*-e2e.mjs): HTTP-anrop mot
// en KÖRANDE Glosan, engångsanvändare och en riktig MCP-klient via OAuth.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CALLBACK = 'https://example.test/callback';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Skripten skapar konton, OAuth-klienter och data — de får aldrig råka köras
 * mot produktion. En annan värd än localhost kräver --allow-remote.
 */
export function assertLocalBase(base) {
  let host = '';
  try { host = new URL(base).hostname; } catch { /* fel URL — stoppas nedan */ }
  if (LOCAL_HOSTS.includes(host) || process.argv.includes('--allow-remote')) return;
  console.error(`Refusing to run against ${base}: e2e scripts create accounts and data. Use a local stack, or pass --allow-remote if you really mean it.`);
  process.exit(2);
}

export function e2e(baseArg) {
  const BASE = (baseArg && !baseArg.startsWith('--') ? baseArg : 'http://localhost:8080').replace(/\/+$/, '');
  assertLocalBase(BASE);
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
 * Containern heter likadant i produktion, så den måste höra till compose-
 * projektet i DEN HÄR utcheckningen (eller anges med E2E_MONGO_CONTAINER).
 */
/**
 * Kör mongosh-kod i den lokala stackens databas — bara om containern hör till
 * just den här checkouten (E2E_MONGO_CONTAINER för att välja en annan).
 */
function localMongo(js, container = process.env.E2E_MONGO_CONTAINER || 'glosan-mongo') {
  if (!process.env.E2E_MONGO_CONTAINER) {
    const dir = execFileSync('docker', ['inspect', '-f', '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}', container], { encoding: 'utf8' }).trim();
    const same = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (same(dir) !== same(REPO_ROOT)) {
      throw new Error(`${container} belongs to ${dir || 'another project'}, not this checkout (${REPO_ROOT}) — refusing to write to it. Set E2E_MONGO_CONTAINER to override.`);
    }
  }
  execFileSync('docker', ['exec', container, 'mongosh', '--quiet', 'glosan', '--eval', js], { stdio: 'pipe' });
}

export function grantFeatureInLocalDb(username, feature, container) {
  localMongo(`db.users.updateOne({ username: ${JSON.stringify(username.toLowerCase())} }, { $addToSet: { features: ${JSON.stringify(feature)} } })`, container);
}

/** Gör en Plugga-länk full (alla platser tagna av dem som redan gått med) — för att testa en full länk. */
export function fillStudyLinkInLocalDb(code, container) {
  localMongo(`db.studysharelinks.updateOne({ code: ${JSON.stringify(code)} }, [{ $set: { maxUses: { $max: [1, { $size: '$usedBy' }] } } }])`, container);
}

/** Låt `username` följa ett område som förr (sharedWith, från före kopiorna) — för att testa bytet till en kopia. */
export function followStudyUnitInLocalDb(unitId, username, container) {
  localMongo(`const u = db.users.findOne({ username: ${JSON.stringify(username.toLowerCase())} }, { _id: 1 }); db.studyunits.updateOne({ _id: ObjectId(${JSON.stringify(unitId)}) }, { $addToSet: { sharedWith: u._id } })`, container);
}

/** Sätt en streak som om `username` senast övade för `daysAgo` dagar sedan — för att testa en levande (1) eller bruten (2+) streak. */
export function setStreakInLocalDb(username, current, daysAgo, container) {
  localMongo(`db.users.updateOne({ username: ${JSON.stringify(username.toLowerCase())} }, { $set: { 'streak.current': ${Number(current)}, 'streak.longest': ${Number(current)}, 'streak.lastActiveDay': new Date(Date.now() - ${Number(daysAgo)} * 86400000) } })`, container);
}

export const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

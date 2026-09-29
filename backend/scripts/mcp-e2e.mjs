// End-to-end-test av MCP-servern mot en KÖRANDE Glosan (via nginx, precis som
// claude.ai ser den). Kör hela kedjan: discovery → OAuth (DCR, authorize,
// samtycke, token, refresh) → varje verktyg via MCP-SDK:ts egen klient →
// koppla bort. Skapar en engångsanvändare och raderar den efteråt.
//
//   cd backend && node scripts/mcp-e2e.mjs http://localhost:8080
//
// Backend måste ha FRONTEND_URL satt till samma bas-URL (issuer), t.ex.
//   FRONTEND_URL=http://localhost:8080 docker compose up --build -d
//
// Samtyckessidan är ett browsersteg; skriptet gör samma POST som sidan gör
// (/api/mcp/oauth/approve med användarens JWT).
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const CALLBACK = 'https://example.test/callback';
let step = 0;
const ok = (msg) => console.log(`  ✓ ${String(++step).padStart(2)} ${msg}`);

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function oauthConnect(jwt, scopes) {
  const reg = await fetch(`${BASE}/api/mcp/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'E2E', redirect_uris: [CALLBACK] })
  });
  assert.equal(reg.status, 201, 'register');
  const { client_id } = await reg.json();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authz = new URL(`${BASE}/api/mcp/oauth/authorize`);
  Object.entries({
    client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'read write offline_access', state: 's1', resource: `${BASE}/api/mcp`
  }).forEach(([k, v]) => authz.searchParams.set(k, v));
  const a = await fetch(authz, { redirect: 'manual' });
  assert.equal(a.status, 302, 'authorize redirects');
  const consent = new URL(a.headers.get('location'));
  assert.equal(consent.origin + consent.pathname, `${BASE}/connect-ai/authorize`, 'consent page url');

  const approve = await fetch(`${BASE}/api/mcp/oauth/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ ...Object.fromEntries(consent.searchParams), approved: true, ...(scopes ? { scopes } : {}) })
  });
  const { redirect } = await json(approve);
  const cb = new URL(redirect);
  assert.equal(cb.searchParams.get('state'), 's1');
  const token = await fetch(`${BASE}/api/mcp/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id, code: cb.searchParams.get('code'), code_verifier: verifier, redirect_uri: CALLBACK })
  });
  assert.equal(token.status, 200, 'token exchange');
  return { client_id, consentUrl: consent, ...(await token.json()) };
}

async function mcpClient(accessToken) {
  const client = new Client({ name: 'glosan-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } }
  }));
  return client;
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const body = JSON.parse(res.content[0].text);
  return { isError: !!res.isError, ...body };
}

async function main() {
  console.log(`Glosan MCP e2e against ${BASE}`);

  // ── Discovery ──────────────────────────────────────────────────────────────
  const prm = await json(await fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`));
  assert.equal(prm.resource, `${BASE}/api/mcp`, 'PRM resource must equal the endpoint URL (is FRONTEND_URL set?)');
  const asMeta = await json(await fetch(`${BASE}/.well-known/oauth-authorization-server`));
  assert.deepEqual(asMeta.code_challenge_methods_supported, ['S256']);
  ok('discovery documents served through nginx');

  const unauth = await fetch(`${BASE}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate') || '', /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  ok('unauthenticated /api/mcp → 401 + WWW-Authenticate');

  // ── Engångsanvändare ───────────────────────────────────────────────────────
  const uname = `mcpe2e${crypto.randomBytes(3).toString('hex')}`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, email: `${uname}@example.test`, password: 'E2e-Passw0rd!x', ageConsent: true })
  });
  assert.equal(reg.status, 201, `register user: ${JSON.stringify(await json(reg.clone()))}`);
  const jwt = (await reg.json()).token;
  ok(`throwaway user ${uname}`);

  try {
    // ── OAuth ────────────────────────────────────────────────────────────────
    const full = await oauthConnect(jwt);
    assert.match(full.access_token, /^glo_/);
    assert.equal(full.scope, 'read write');
    const page = await fetch(full.consentUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root">/);
    assert.equal(full.consentUrl.searchParams.get('client_name'), null, 'the name is never taken from the URL');
    const info = await json(await fetch(`${BASE}/api/mcp/oauth/client?${new URLSearchParams({ client_id: full.client_id, redirect_uri: CALLBACK })}`));
    assert.deepEqual(info, { client_name: 'E2E', redirect_host: 'example.test', trust: 'unknown' });
    ok('OAuth: register → authorize → consent page (SPA, app info from the server: unknown host) → approve → token');

    // ── Verktyg ──────────────────────────────────────────────────────────────
    const client = await mcpClient(full.access_token);
    assert.match(client.getInstructions() || '', /Glosan/);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    // De 14 glosverktygen — fler finns om kontot har Plugga (funktionsflagga).
    const VOCAB_TOOLS = ['get_source_info', 'get_profile', 'list_lists', 'get_list', 'create_list', 'update_list', 'swap_list_direction', 'delete_list', 'add_words', 'update_word', 'delete_words', 'list_hard_words', 'list_categories', 'create_category'];
    assert.deepEqual(VOCAB_TOOLS.filter((t) => !tools.includes(t)), [], `tools: ${tools}`);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    assert.ok(prompts.includes('list_from_photo') && prompts.includes('practice_hard_words'));
    ok(`initialize + tools/list (${tools.length} tools, incl. all 14 vocabulary tools) + prompts/list`);

    const created = await call(client, 'create_list', {
      title: 'Engelska v. 38 — Mat',
      description: 'Kapitel 4',
      source_lang: 'SV',
      target_lang: 'en',
      words: [
        { source: 'äpple', target: 'an apple' },
        { source: 'smörgås', target: 'a sandwich' },
        { source: 'gurka', target: 'a cucumber', notes: 'uttalas /ˈkjuːkʌmbə/' },
        { source: 'söt/gullig', target: 'cute' },
        { source: 'Äpple', target: 'An apple' }
      ]
    });
    assert.equal(created.isError, false, JSON.stringify(created));
    assert.equal(created.data.word_count, 4);
    assert.equal(created.data.source_lang, 'sv');
    assert.equal(created.data.skipped_duplicates.length, 1);
    assert.equal(created.data.url, `${BASE}/lists/${created.data.list_id}`);
    const listId = created.data.list_id;
    ok('create_list with words (photo flow) — lowercases lang, skips in-batch duplicate');

    const added = await call(client, 'add_words', {
      list_id: listId,
      words: [{ source: 'gurka', target: 'a cucumber' }, { source: 'mjölk', target: 'milk', extra: true }]
    });
    assert.equal(added.data.added.length, 1);
    assert.equal(added.data.skipped_duplicates.length, 1);
    assert.equal(added.data.word_count, 5);
    ok('add_words skips pairs already on the list');

    const got = await call(client, 'get_list', { list_id: listId });
    assert.equal(got.data.words.length, 5);
    assert.equal(got.data.words.find((w) => w.source === 'mjölk').extra, true);
    const gurka = got.data.words.find((w) => w.source === 'gurka');
    ok('get_list returns words with stats');

    const upd = await call(client, 'update_word', { word_id: gurka.word_id, target: 'a cucumber', example_sentence: 'I like cucumbers.' });
    assert.equal(upd.data.example_sentence, 'I like cucumbers.');
    ok('update_word');

    const lists = await call(client, 'list_lists');
    assert.equal(lists.data.length, 1);
    assert.equal(lists.data[0].word_count, 5);
    ok('list_lists');

    const swapped = await call(client, 'swap_list_direction', { list_id: listId });
    assert.equal(swapped.data.source_lang, 'en');
    const after = await call(client, 'get_list', { list_id: listId, include_stats: false });
    assert.equal(after.data.words.find((w) => w.target === 'gurka').source, 'a cucumber');
    await call(client, 'swap_list_direction', { list_id: listId });
    ok('swap_list_direction (and back)');

    const cat = await call(client, 'create_category', { name: 'Engelska', color: 'sky' });
    const dupCat = await call(client, 'create_category', { name: 'Engelska' });
    assert.equal(dupCat.error.code, 'conflict');
    const moved = await call(client, 'update_list', { list_id: listId, category_id: cat.data.category_id });
    assert.equal(moved.data.category_id, cat.data.category_id);
    const cats = await call(client, 'list_categories');
    assert.equal(cats.data[0].list_count, 1);
    ok('create_category / list_categories / update_list');

    const foreign = await call(client, 'get_list', { list_id: '64b000000000000000000001' });
    assert.equal(foreign.error.code, 'not_found');
    const hard = await call(client, 'list_hard_words');
    assert.equal(hard.isError, false);
    const profile = await call(client, 'get_profile');
    assert.equal(profile.data.username, uname);
    assert.equal(profile.data.total_words, 5);
    const about = await call(client, 'get_source_info');
    assert.equal(about.data.license, 'AGPL-3.0-or-later');
    ok('not_found for unknown ids, list_hard_words, get_profile, get_source_info');

    const del = await call(client, 'delete_words', { list_id: listId, word_ids: [gurka.word_id] });
    assert.equal(del.data.deleted.length, 1);
    const gone = await call(client, 'delete_list', { list_id: listId });
    assert.equal(gone.data.words_deleted, 4);
    ok('delete_words + delete_list');
    await client.close();

    // ── Läs-anslutning ───────────────────────────────────────────────────────
    const ro = await oauthConnect(jwt, ['read']);
    assert.equal(ro.scope, 'read');
    const roClient = await mcpClient(ro.access_token);
    const roTools = (await roClient.listTools()).tools.map((t) => t.name);
    assert.ok(!roTools.includes('create_list'), 'read-only must not see create_list');
    const denied = await roClient.callTool({ name: 'create_list', arguments: { title: 'x', source_lang: 'sv', target_lang: 'en' } });
    assert.equal(denied.isError, true);
    await roClient.close();
    ok(`read-only connection: ${roTools.length} tools, write tools uncallable`);

    // ── Refresh + koppla bort ────────────────────────────────────────────────
    const refreshed = await fetch(`${BASE}/api/mcp/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: full.client_id, refresh_token: full.refresh_token })
    });
    const next = await refreshed.json();
    assert.match(next.access_token, /^glo_/);
    const stale = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${full.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(stale.status, 401);
    ok('refresh rotates tokens; the old access token is dead');

    const conns = await json(await fetch(`${BASE}/api/mcp/connections`, { headers: { Authorization: `Bearer ${jwt}` } }));
    assert.equal(conns.connections.length, 2);
    const target = conns.connections.find((c) => c.scopes.includes('write'));
    const revoke = await fetch(`${BASE}/api/mcp/connections/${target.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(revoke.status, 200);
    const dead = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${next.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(dead.status, 401);
    ok('profile page lists connections; disconnecting kills access immediately');
  } finally {
    const cleanup = await fetch(`${BASE}/api/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` } });
    console.log(cleanup.ok ? `  · deleted throwaway user ${uname}` : `  ! could not delete ${uname} (${cleanup.status})`);
  }
  console.log('All good.');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message);
  process.exit(1);
});

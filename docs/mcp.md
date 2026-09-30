# MCP server — connect Claude (and other AIs) to Glosan

Glosan exposes an [MCP](https://modelcontextprotocol.io) server at
`https://glosan.app/api/mcp`. A user adds it as a **connector** in claude.ai
(or Claude Desktop, ChatGPT, …), approves once, and the AI can then read and
edit their lists. The headline use case: photograph a vocabulary sheet in
Claude, say "make a list of this", and the list appears in Glosan.

The image never reaches Glosan — Claude reads the photo itself and calls
`create_list` with the words. So this costs no Glosan AI quota.

The design is ported from Cellarion's MCP server (same OAuth server, same
declarative tool registry), trimmed to what Glosan needs: **stateless only**
(no sessions/SSE pushes), no resources, no undo ledger.

## Connecting (user side)

1. Glosan → **Profil → Koppla din AI** shows the endpoint URL.
2. claude.ai → **Settings → Connectors → Add custom connector**, paste the URL.
3. Claude opens Glosan's consent page (`/connect-ai/authorize`). The user logs
   in (password or Google) and picks **Bara läsa** or **Läsa och skapa**.
4. Done. Connections are listed on the Profile page, each with a
   **Koppla bort** button that kills access immediately.

## Flow

```
Claude ──POST /api/mcp (no token)──────────────▶ 401 + WWW-Authenticate: resource_metadata=…
       ──GET /.well-known/oauth-protected-resource/api/mcp ─▶ PRM (RFC 9728)
       ──GET /.well-known/oauth-authorization-server ───────▶ AS metadata (RFC 8414)
       ──POST /api/mcp/oauth/register ─────────────▶ client_id (RFC 7591 DCR)
browser──GET  /api/mcp/oauth/authorize ────────────▶ 302 /connect-ai/authorize (consent page)
browser──POST /api/mcp/oauth/approve (user's JWT) ─▶ { redirect: callback?code=… }
Claude ──POST /api/mcp/oauth/token (code + PKCE) ──▶ glo_ access token (1 h) + refresh token
Claude ──POST /api/mcp (Bearer glo_…) ─────────────▶ tools
```

## Where things live

| Path | What |
|---|---|
| `backend/src/routes/mcp.js` | `POST /api/mcp` (+ 405 for GET/DELETE), limiters, 401 challenge, `/api/mcp/connections` for the Profile page |
| `backend/src/routes/mcpOAuth.js` | OAuth 2.1 server: register, authorize, client (for the consent page), approve, token, revoke |
| `backend/src/routes/wellKnownOAuth.js` | The two discovery documents, mounted at the origin root |
| `backend/src/middleware/mcpAuth.js` | Accepts `glo_` tokens (only here — they never reach the REST API) or the user's own JWT |
| `backend/src/services/mcpOAuth.js` | PKCE, scopes, metadata, token minting, revoke-all |
| `backend/src/models/{McpToken,OAuthClient,OAuthAuthCode}.js` | A connection, a registered connector, a one-time auth code |
| `backend/src/mcp/server.js` | Builds one MCP server per request with only the tools the scopes allow; call + write budgets |
| `backend/src/mcp/registry.js` | `registerTool` / `registerPrompt` |
| `backend/src/mcp/tools/*.js` | The tools (`lists`, `words`, `categories`, `meta`, and `study` — Plugga, behind the `study` flag) |
| `backend/src/mcp/instructions.js` | Server instructions — the "system prompt" the AI gets at connect |
| `frontend/src/pages/ConnectAiAuthorize.jsx` | Consent page |
| `frontend/src/components/AiConnectSection.jsx` | Profile section |

## Tools

| Scope | Tools |
|---|---|
| public | `get_source_info` |
| read | `list_lists`, `get_list`, `list_hard_words`, `list_categories`, `get_profile` |
| write | `create_list` (with up to 300 words; at most 1000 lists per account), `add_words`, `update_word`, `delete_words`, `update_list`, `swap_list_direction`, `delete_list`, `create_category` |

A write connection can always read too (`write` implies `read`).

Prompts (slash commands in clients that support them): `list_from_photo`,
`practice_hard_words`.

Accounts with the `study` feature flag also get the 25 **Plugga** tools
(school subjects: units, genomgångar, flashcards, exercises incl. templates
and figures, practice tests, the paper flow, Mappar, "Min plugg") and the
prompts `study_from_photos`, `check_my_solution`, `prepare_for_test` and
`check_my_test`. For everyone else they are not registered at all. See
[plugga.md](plugga.md).

Deliberately **not** exposed: sharing with friends, duels, account settings,
plans, deleting the account, disconnecting AIs. The instructions tell the AI to
point the user at the web app for those.

## Security model

- **Scopes are structural.** A read-only connection's server never registers
  the write tools, so they are uncallable, not just hidden.
- **Tokens only open `/api/mcp`.** `glo_` tokens are accepted by
  `requireMcpAuth` alone; `requireAuth` (every REST route) rejects them.
- **PKCE S256 is mandatory** (a 43-character challenge), redirect URIs are
  exact-matched and validated before any redirect, codes are single-use and
  live 5 minutes, `state` is at most 512 characters.
- **No open redirect.** Anyone can register a client (DCR), so protocol errors
  are only redirected to hosts Glosan knows (claude.ai, claude.com,
  chatgpt.com, chat.openai.com, loopback, plus `MCP_KNOWN_REDIRECT_HOSTS`);
  for others `/authorize` answers with a plain 400.
- **The consent page reads who is asking from the server** (`GET
  /api/mcp/oauth/client`), never from the URL, and shows a clear "Okänd app"
  warning when the redirect host is unknown — a client can call itself
  "Claude", its redirect host can't lie.
- **Refresh tokens rotate** on every use (atomically). The last 10 spent
  refresh tokens are remembered: replaying one revokes the whole connection
  (reuse detection) — except the latest within 2 minutes of the rotation,
  which is two parallel refreshes or a lost response and is only refused. A
  connection unused for 90 days falls asleep (reconnect). Revoked connections
  are deleted after 30 days.
- **Consent needs a logged-in user** (JWT). The consent page is UX — `/approve`
  re-validates everything and only lets the user *narrow* scopes. A login from
  before a password reset can't approve, and a code minted before it can't be
  exchanged (`User.credentialsChangedAt`).
- **One JSON-RPC message per request** — batches are refused, so the HTTP
  limiters count what they should.
- **Other people's text is data.** Shared lists and units, titles, notes and
  error reports reach the AI labelled (`written_by_someone_else`,
  `reporter_note_untrusted`), never in a `summary` or error message, and the
  instructions say to treat them as data.
- **Budgets:** max 20 tool calls per HTTP request, 120 write calls per user per
  15 minutes, plus per-IP and per-user HTTP limiters. `/api/mcp` and the OAuth
  endpoints are exempt from the global per-IP limiters because claude.ai's
  users all share a small egress IP pool.
- **Revocation:** per connection from the Profile page; all connections and
  pending auth codes on password reset; everything on account deletion.
  Connections appear in the GDPR export (metadata only).

## Adding a tool

This is how a module plugs in (Plugga's `mcp/tools/study.js` is the big example):

```js
// backend/src/mcp/tools/<area>.js — then require it in tools/index.js
registerTool({
  name: 'create_flashcards',           // snake_case, unique
  title: 'Create flashcards',
  description: 'WHEN to use it and WHAT it does — this text drives the model.',
  scope: 'write',                      // 'public' | 'read' | 'write'
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: { list_id: objectId, cards: z.array(...).max(300) },
  handler: async (args, ctx) => {      // ctx.user.id is the verified user
    // check ownership (toolUtil.resolveList), then do the work
    return ok('Created 12 cards', data); // or fail('not_found', 'model-readable hint')
  }
});
```

Rules the tests enforce (`src/mcp/registry.test.js`): write tools declare
`readOnlyHint: false` (that is what charges the write budget), read tools
`readOnlyHint: true`, deletions — and overwrites of study content others may
share — `destructiveHint: true`. Mention new tool families in
`instructions.js`. Keep user-written text (titles, notes, names) out of
`summary` and error messages: put it in `data` (`fail(code, message, extra)`
takes extra fields for candidates).

## Deploying

No containers or migrations. Optional env: `MCP_KNOWN_REDIRECT_HOSTS`
(more AI services the consent page recognises). The image reports its release
tag (`APP_VERSION`, set by the release workflow) in `/api/health` and the MCP
server info. `frontend/nginx.conf` (which proxies
the two `/.well-known/oauth-*` paths to the backend and raises the body limit
for `/api/mcp` to 1 MB) is baked into the frontend image, so a normal release
ships everything.

⚠️ The OAuth issuer is the **first** entry of `FRONTEND_URL`. On the VM it must
start with `https://glosan.app`, and users must connect with
`https://glosan.app/api/mcp` (not the legacy domain — the resource URL has to
match the issuer).

If Cloudflare's bot protection is strict, make sure Anthropic's connector
traffic (`160.79.104.0/21`) can reach `/.well-known/*` and `/api/mcp/*`.

Verify after deploy:

```bash
curl -s https://glosan.app/.well-known/oauth-authorization-server | jq .issuer
# → "https://glosan.app"
curl -s https://glosan.app/.well-known/oauth-protected-resource/api/mcp | jq .resource
# → "https://glosan.app/api/mcp"
curl -si -X POST https://glosan.app/api/mcp | grep -i www-authenticate
# → WWW-Authenticate: Bearer resource_metadata="https://glosan.app/.well-known/oauth-protected-resource/api/mcp", scope="read write"
curl -s https://glosan.app/api/health | jq .version
# → the release tag, e.g. "0.1.29"
```

The checks above never load the MCP SDK (the 401 comes first). To prove the
SDK and the tools load, call `tools/list` with your own login (a JWT is
accepted on `/api/mcp`):

```bash
curl -s https://glosan.app/api/mcp -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"[a-z_]*"' | head
```

Then add the connector in claude.ai and create a list from a photo.

## Testing locally

```bash
cd backend && npm test                      # unit + route tests (no DB)
FRONTEND_URL=http://localhost:8080 docker compose up --build -d
cd backend && node scripts/mcp-e2e.mjs http://localhost:8080
```

`mcp-e2e.mjs` runs the whole chain through nginx with the real MCP SDK client:
discovery, OAuth, every tool, a read-only connection, refresh rotation and
disconnecting. It creates a throwaway user and deletes it afterwards. The e2e
scripts refuse any base URL that isn't localhost (pass `--allow-remote` if you
really mean it), and CI (`.github/workflows/ci.yml`) runs all three against a
Docker stack on every PR and before every release.

claude.ai cannot reach `localhost`; to try the real Claude against a local
build you need a public HTTPS tunnel with `FRONTEND_URL` set to its URL.

## Rollback

Remove the two `/.well-known/oauth-*` blocks from `nginx.conf` and redeploy
(that is a new **frontend** release — nginx.conf is baked into that image) —
discovery stops resolving, so no new connections can be made. Clients that
already know the endpoints can still reach `/api/mcp/oauth/*`. Faster, with no
release: `MCP_DISABLED=true` in the VM's `.env` and a backend restart answers
503 on discovery, OAuth and `/api/mcp`. To cut off existing connections too:

```js
db.mcptokens.updateMany({ revokedAt: null }, { $set: { revokedAt: new Date() } })
```

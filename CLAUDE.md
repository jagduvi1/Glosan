# Glosan — Claude Code Guide

## Project Overview

Glosan is a self-hosted vocabulary app (MERN stack) with optional AI helpers
powered by Anthropic Claude. Users create their own vocab lists, practice
with quiz mode, and can let Claude generate words / example sentences /
translations.

- **GitHub repo:** https://github.com/jagduvi1/Glosan
- **Production:** https://glosan.app (canonical — also the MCP OAuth issuer; the legacy https://glosan.jeklund.dev still serves the app)

---

## Development Workflow

**Before any implementation:**

1. **New branch off `main`:**
   ```bash
   git checkout main && git pull
   git checkout -b feat/<short-description>
   ```

2. **Implement** the changes.

3. **Test** — verify in Docker before pushing:
   ```bash
   docker compose up --build
   ```

4. **Push and open a PR:**
   ```bash
   git push -u origin <branch-name>
   gh pr create --base main --title "..." --body "..."
   ```

Never commit directly to `main`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | MongoDB 7 (Mongoose 8) |
| Backend | Express 4, Node 24 |
| Frontend | React 19, React Router 7, Vite 8 |
| Auth | JWT (15m access + 7d httpOnly refresh), bcryptjs |
| AI | `@anthropic-ai/sdk` (default model: `claude-haiku-4-5-20251001`) |
| Containerisation | Docker Compose |
| Reverse proxy | Traefik (external `web` network) |

---

## Repository Structure

```
Glosan/
├── backend/
│   ├── server.js
│   └── src/
│       ├── app.js
│       ├── config/db.js
│       ├── middleware/auth.js
│       ├── models/{User,GlosList,Glos,McpToken,OAuthClient,OAuthAuthCode,Study*}.js
│       ├── routes/{health,auth,oauth,lists,glosor,ai,mcp,mcpOAuth,wellKnownOAuth,study,studyInvites,admin,me,friends}.js
│       ├── config/{plans,features,subjects}.js
│       ├── services/{anthropic,authTokens,oauthStateStore,email,mcpOAuth,studyData}.js
│       └── mcp/{server,registry,toolUtil,instructions,prompts}.js + mcp/tools/*.js
├── frontend/
│   ├── Dockerfile, nginx.conf, vite.config.js, index.html
│   └── src/
│       ├── App.jsx, main.jsx, index.css
│       ├── contexts/AuthContext.jsx
│       ├── utils/apiFetch.js
│       ├── components/{Layout,ProtectedRoute,Analytics,StudyMarkdown}.jsx + components/study/
│       └── pages/{Login,Register,Lists,ListDetail,Quiz,Plugga*,ConnectAiAuthorize}.jsx
├── docker-compose.yml
└── .env.example
```

---

## Core Data Models

| Model | Description |
|-------|-------------|
| `User` | Auth & profile, roles: `user` / `admin`. Refresh-token hash stored. |
| `GlosList` | A named vocabulary list owned by one user. `{ user, title, description, sourceLang, targetLang }` |
| `Glos` | One word pair in a list. `{ list, source, target, notes, exampleSentence, stats: { correct, wrong, lastReviewedAt } }` |
| `Study*` | Plugga (school subjects, behind the `study` flag): `StudyUnit` (område), `StudyPage` (genomgång), `StudyItem` (card/exercise), per-user `StudyItemState`/`StudyAttempt`/`StudySession`, `StudyFolder` (Mapp), `StudyTest`/`StudyTestAttempt` (övningsprov), `StudyShareLink` (QR), `StudyItemDeletion` (bin log), `StudyFlag`. See [docs/plugga.md](docs/plugga.md). |

---

## Environment Variables

Copy `.env.example` → `.env` and set:

| Variable | Required | Default |
|----------|----------|---------|
| `JWT_SECRET` | **Yes** | — |
| `MONGO_URI` | No | `mongodb://mongo:27017/glosan` |
| `ACCESS_TOKEN_EXPIRES_IN` | No | `15m` |
| `PORT` | No | `5000` |
| `FRONTEND_URL` | No | `http://localhost` (first entry is also the MCP OAuth issuer) |
| `FEATURES_FOR_ALL` | No | — (comma-separated feature flags on for everyone, e.g. `study`) |
| `FEATURES_DISABLED` | No | — (emergency brake: flags OFF for everyone, wins over everything) |
| `MCP_KNOWN_REDIRECT_HOSTS` | No | — (more AI services the MCP consent page recognises) |
| `RESEND_API_KEY` / `EMAIL_FROM` | No (required for verify/reset email) | — |
| `ANTHROPIC_API_KEY` | No (required for AI routes) | — |
| `GOOGLE_CLIENT_ID` | No (required for Google login) | — |
| `GOOGLE_CLIENT_SECRET` | No (required for Google login) | — |
| `GOOGLE_CALLBACK_URL` | No | `<first FRONTEND_URL>/api/auth/google/callback` |

---

## Common Commands

```bash
# Start all services
docker compose up --build

# Stop (keep data)
docker compose down

# Wipe everything including DB
docker compose down -v

# Backend dev (hot reload, outside Docker)
cd backend && npm run dev

# Frontend dev (outside Docker) — Vite, ~0.5s startup
cd frontend && npm install && npm run dev   # http://localhost:3000

# Tests
cd backend && npm test
# MCP end-to-end against a running stack (see docs/mcp.md)
FRONTEND_URL=http://localhost:8080 docker compose up --build -d
cd backend && node scripts/mcp-e2e.mjs http://localhost:8080
# Plugga end-to-end (with or without FEATURES_FOR_ALL=study)
cd backend && node scripts/plugga-e2e.mjs http://localhost:8080
cd backend && node scripts/plugga-fas2-e2e.mjs http://localhost:8080
# Browser end-to-end: pages at phone size in headless Chrome (puppeteer-core,
# your installed Chrome; CHROME_PATH overrides; screenshot on failure in browser-shots/)
cd backend && node scripts/browser-e2e.mjs http://localhost:8080
# Frontend unit tests not configured yet — add Vitest when you write the first test.

# Change dependencies with the image's npm (backend or frontend): a different
# local npm can write a lockfile that `npm ci` in the Docker build rejects
# (EUSAGE). Without <pkg> it just regenerates the lockfile, e.g. on a Dependabot
# PR. MSYS_NO_PATHCONV stops Git Bash from mangling the paths; a no-op elsewhere.
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/backend:/app" -w /app node:24-alpine npm install <pkg> --package-lock-only
# App icons (favicon.ico, home-screen PNGs) are drawn from assets/logo-mark.svg
cd backend && node scripts/make-icons.mjs
```

---

## Architectural Patterns

- **Auth:** Access token (JWT, 15m) in `Authorization: Bearer <token>`. Refresh token (random 64 bytes, hashed in DB) in an httpOnly cookie. `apiFetch` in [frontend/src/utils/apiFetch.js](frontend/src/utils/apiFetch.js) auto-refreshes on 401 and retries the request. Token issuing lives in [backend/src/services/authTokens.js](backend/src/services/authTokens.js), shared by password login and SSO.
- **Google SSO:** [backend/src/routes/oauth.js](backend/src/routes/oauth.js) — mirrored from Cellarion (passport-google-oauth20, PKCE + cookie state store, account linking on verified email). Opt-in: inert without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; the frontend button probes `GET /api/auth/sso/providers` at runtime, so enabling needs no frontend rebuild.
- **Middleware:** [backend/src/middleware/auth.js](backend/src/middleware/auth.js) exports `requireAuth`, `optionalAuth`, `requireAdmin`. All non-public routes use `requireAuth`.
- **Client IP and rate limits:** production is Cloudflare → Traefik → nginx → backend. [utils/clientIp.js](backend/src/utils/clientIp.js) sets `req.ip` from `CF-Connecting-IP` only when the connecting edge is in Cloudflare's published ranges (update the list if Cloudflare adds ranges). Limiters key per user when a genuine JWT is present, even one that just expired ([middleware/rateKeys.js](backend/src/middleware/rateKeys.js)), and per IP otherwise — always through `ipKey()`, which counts IPv6 per /56 — so a classroom behind one school IP fits; login is per IP + username ([middleware/authLimits.js](backend/src/middleware/authLimits.js)), and the auth routes skip the global limiters in app.js.
- **Maintenance:** [services/maintenance.js](backend/src/services/maintenance.js) runs hourly in the backend: mails admins when the disk is over `DISK_ALERT_PERCENT` and closes abandoned Plugga sessions. Retention is TTL indexes on the models (see the Retention section in [docs/plugga.md](docs/plugga.md)).
- **Ownership checks:** Routes that touch a `GlosList` or `Glos` verify `list.user === req.user.id` before any mutation. Helper `loadOwnedList(req, res, next)` could be extracted if duplication grows.
- **AI:** [backend/src/services/anthropic.js](backend/src/services/anthropic.js) lazy-creates the client and returns 503 if `ANTHROPIC_API_KEY` is unset. Prompts ask for JSON and the service parses defensively.
- **Image import:** `POST /api/ai/parse-image` takes a base64 image and returns the *same* shape as `/parse-list`, so [ImportModal](frontend/src/components/ImportModal.jsx) reuses the whole review-and-save step. The client downscales to 1600px JPEG first ([utils/image.js](frontend/src/utils/image.js)) — a phone photo is 2–12 MB raw, ~300 kB scaled. The image is never stored. Body limits are raised **only** for that one route (app.js + nginx.conf); the rest of the API stays at 64 kB.
- **MCP server:** `POST /api/mcp` lets claude.ai & co. read and edit a user's lists (photo → `create_list` is the headline flow — Claude reads the image, Glosan never sees it). Ported from Cellarion but stateless-only. Connectors authorize through Glosan's own OAuth 2.1 server ([routes/mcpOAuth.js](backend/src/routes/mcpOAuth.js), consent page `/connect-ai/authorize`) and get `glo_` tokens that **only** [middleware/mcpAuth.js](backend/src/middleware/mcpAuth.js) accepts. Tools are declared with `registerTool` in [backend/src/mcp/tools/](backend/src/mcp/tools); scope filtering is structural (a read-only connection never gets write tools registered). The MCP routes must stay mounted **before** the routers on `/api` in app.js — `glosor.js` runs `requireAuth` on the whole prefix. Full guide: [docs/mcp.md](docs/mcp.md).
- **Feature flags:** hidden modules are gated per account (`User.features`, switched on the admin page) or for everyone (`FEATURES_FOR_ALL`); catalogue in [config/features.js](backend/src/config/features.js). Backend routes use `requireFeature(key)` (404 when off), the frontend `hasFeature(user, key)`, and MCP tools/prompts/instructions declare `feature: '<key>'` so they're only registered for flagged users.
- **Plugga (school subjects):** behind the `study` flag. Content is created **only via MCP** by the user's own AI, and **Glosan never calls an AI API in Plugga** — don't import `services/anthropic.js` there. Progress is per user (`StudyItemState`), never on the item, because units can be shared. Use `services/studyData.js` for deleting units/accounts and the export, and `services/study/itemDeletion.js` for deleting items (it logs them). Template exercises are graded against the seed the client sends back (`services/study/templates.js` — a hand-written expression parser, never `eval`); ```svg figures render only as `<img>`. Design + phases: [docs/plugga.md](docs/plugga.md).
- **Sharing and blocking:** lists and Plugga units are shared with confirmed friends or by link (`/j/` gives a copy, and befriends only when the creator ticks that box in the app; `/p/` gives access to one or more units without friendship). The rules live in [services/listSharing.js](backend/src/services/listSharing.js) and [services/study/sharing.js](backend/src/services/study/sharing.js), used by both the app and the MCP share tools. A block list ([services/blocks.js](backend/src/services/blocks.js)) ends everything between two accounts and is checked wherever someone could reconnect (friend codes, list and unit links).
- **Frontend API client:** Pages should call helpers from [frontend/src/api/](frontend/src/api) (e.g. `lists.js`, `glosor.js`, `ai.js`) rather than writing raw `fetch` calls. Each helper takes `apiFetch` as its first argument.
- **Build env vars:** Frontend env vars must be prefixed `VITE_` and accessed via `import.meta.env.VITE_*`. They are read at build time and baked into the bundle — see `Analytics.jsx` for the pattern.
- **CI:** `.github/workflows/ci.yml` runs jest, the frontend build, the three API e2e scripts and the browser e2e (headless Chrome, uploads a screenshot when it fails) against a Docker stack on every PR and push to main; `release.yml` builds images only after it passes and stamps the release tag into the backend (`APP_VERSION` → `/api/health`). The e2e scripts refuse non-localhost URLs unless given `--allow-remote`.

---

## Working with Anthropic

Default model: `claude-haiku-4-5-20251001` — fast and cheap for short vocab tasks.
For longer/harder tasks bump to `claude-sonnet-5` — newer *and* cheaper than
sonnet-4-6 ($2/$10 vs $3/$15 per MTok). Image parsing already uses it:
`anthropic.VISION_MODEL`.

The service expects the model to respond with JSON. Always:
1. Set a hard `max_tokens` ceiling (e.g. 1024).
2. Use the system prompt to constrain the output format.
3. Parse with try/catch — if JSON parsing fails, return a 502 rather than
   trusting the raw string.

Add prompt caching as soon as a prompt grows past ~1k tokens — see
https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.

---

## Branch Naming

- `feat/<description>` — new feature
- `fix/<description>` — bug fix
- `refactor/<description>` — code refactor
- `docs/<description>` — documentation only
- `chore/<description>` — tooling / dependency updates

---

## Commit Rules

- Keep commits focused — one logical change per commit.
- Subject line under 70 characters, imperative mood (`add quiz mode`, not
  `added quiz mode`).

---

## License

Glosan is licensed under **GNU Affero General Public License v3.0 or later**
(AGPL-3.0-or-later). Full text in [LICENSE](LICENSE). Both `backend/package.json`
and `frontend/package.json` carry the SPDX identifier; new source files don't
need an additional header.

The four bundled fonts in [frontend/src/assets/fonts/](frontend/src/assets/fonts/)
(Nunito, Lilita One, Patrick Hand, JetBrains Mono) are **SIL OFL-1.1**, not AGPL —
see `LICENSE.txt` in that directory. They are self-hosted deliberately: the CSP
allows only `self` for styles and fonts, so a Google Fonts `@import` is blocked in
production, and self-hosting also keeps users’ IP addresses away from Google.

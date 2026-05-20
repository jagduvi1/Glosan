# Glosan — Claude Code Guide

## Project Overview

Glosan is a self-hosted vocabulary app (MERN stack) with optional AI helpers
powered by Anthropic Claude. Users create their own vocab lists, practice
with quiz mode, and can let Claude generate words / example sentences /
translations.

- **GitHub repo:** https://github.com/jagduvi1/Glosan
- **Production:** https://glosan.jeklund.dev

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
| Backend | Express 4, Node 20 |
| Frontend | React 19, React Router 6, Vite 5 |
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
│       ├── models/{User,GlosList,Glos}.js
│       ├── routes/{health,auth,lists,glosor,ai}.js
│       └── services/anthropic.js
├── frontend/
│   ├── Dockerfile, nginx.conf, vite.config.js, index.html
│   └── src/
│       ├── App.js, main.jsx, index.css
│       ├── contexts/AuthContext.js
│       ├── utils/apiFetch.js
│       ├── components/{Layout,ProtectedRoute,Analytics}.js
│       └── pages/{Login,Register,Lists,ListDetail,Quiz}.js
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

---

## Environment Variables

Copy `.env.example` → `.env` and set:

| Variable | Required | Default |
|----------|----------|---------|
| `JWT_SECRET` | **Yes** | — |
| `MONGO_URI` | No | `mongodb://mongo:27017/glosan` |
| `ACCESS_TOKEN_EXPIRES_IN` | No | `15m` |
| `PORT` | No | `5000` |
| `FRONTEND_URL` | No | `http://localhost` |
| `ANTHROPIC_API_KEY` | No (required for AI routes) | — |

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
# Frontend tests not configured yet — add Vitest when you write the first test.
```

---

## Architectural Patterns

- **Auth:** Access token (JWT, 15m) in `Authorization: Bearer <token>`. Refresh token (random 64 bytes, hashed in DB) in an httpOnly cookie. `apiFetch` in [frontend/src/utils/apiFetch.js](frontend/src/utils/apiFetch.js) auto-refreshes on 401 and retries the request.
- **Middleware:** [backend/src/middleware/auth.js](backend/src/middleware/auth.js) exports `requireAuth`, `optionalAuth`, `requireAdmin`. All non-public routes use `requireAuth`.
- **Ownership checks:** Routes that touch a `GlosList` or `Glos` verify `list.user === req.user.id` before any mutation. Helper `loadOwnedList(req, res, next)` could be extracted if duplication grows.
- **AI:** [backend/src/services/anthropic.js](backend/src/services/anthropic.js) lazy-creates the client and returns 503 if `ANTHROPIC_API_KEY` is unset. Prompts ask for JSON and the service parses defensively.
- **Frontend API client:** Pages should call helpers from [frontend/src/api/](frontend/src/api) (e.g. `lists.js`, `glosor.js`, `ai.js`) rather than writing raw `fetch` calls. Each helper takes `apiFetch` as its first argument.
- **Build env vars:** Frontend env vars must be prefixed `VITE_` and accessed via `import.meta.env.VITE_*`. They are read at build time and baked into the bundle — see `Analytics.js` for the pattern.

---

## Working with Anthropic

Default model: `claude-haiku-4-5-20251001` — fast and cheap for short vocab tasks.
For longer/harder tasks (e.g. nuanced explanations) bump to `claude-sonnet-4-6`.

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

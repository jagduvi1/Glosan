# Glosan

Glos-app (MERN) med AI-hjälp. Användare skapar egna glos-listor, övar med
quiz, och kan låta Anthropic Claude generera glosor / exempelmeningar /
översättningar.

## Stack

| Lager | Teknologi |
|-------|-----------|
| Databas | MongoDB 7 (Mongoose 8) |
| Backend | Express 4, Node 20 |
| Frontend | React 19, React Router 6 |
| Auth | JWT (15 min access-token + 7d httpOnly refresh-cookie), bcryptjs |
| AI | `@anthropic-ai/sdk` |
| Reverse proxy | Traefik (extern `web`-nätverk) |
| Analytics | Umami (opt-in via env) |
| Containerisering | Docker Compose |

## Snabbstart

```bash
cp .env.example .env
# sätt JWT_SECRET till en stark slumpsträng, och ANTHROPIC_API_KEY om du
# vill testa AI-rutterna lokalt

# Skapa Traefiks externa nätverk om det inte redan finns på din VM
docker network create web 2>/dev/null || true

docker compose up --build
```

Backend lyssnar internt på port 5000, frontend serveras via nginx på port 80
och routas av Traefik på `glosan.jeklund.dev`.

## Repo-struktur

```
Glosan/
├── backend/
│   ├── server.js                  Entry point — validerar env och startar app
│   └── src/
│       ├── app.js                 Express-app (helmet, cors, rate-limit, routes)
│       ├── config/db.js           MongoDB-anslutning
│       ├── middleware/auth.js     requireAuth / optionalAuth / requireAdmin
│       ├── models/                User, GlosList, Glos
│       ├── routes/                health, auth, lists, glosor, ai
│       └── services/anthropic.js  Anthropic-klient (Claude Haiku 4.5)
├── frontend/
│   ├── Dockerfile                 Två steg: bygg + serva med nginx
│   ├── nginx.conf                 /api-proxy + SPA-fallback
│   └── src/
│       ├── App.js                 Routes
│       ├── contexts/AuthContext   Session, auto-refresh, apiFetch
│       ├── utils/apiFetch.js      fetch-wrapper med 401-refresh
│       ├── components/            Layout, ProtectedRoute, Analytics
│       └── pages/                 Login, Register, Lists, ListDetail, Quiz
└── docker-compose.yml
```

## Backend API

| Metod | Endpoint | Auth | Beskrivning |
|-------|----------|------|-------------|
| GET | `/api/health` | — | Mongo-status + version |
| POST | `/api/auth/register` | — | Skapa konto |
| POST | `/api/auth/login` | — | Logga in (sätter refresh-cookie) |
| POST | `/api/auth/refresh` | cookie | Ny access-token |
| POST | `/api/auth/logout` | yes | Invalidera refresh-token |
| GET | `/api/auth/me` | yes | Nuvarande användare |
| GET | `/api/lists` | yes | Mina listor |
| POST | `/api/lists` | yes | Skapa lista |
| GET | `/api/lists/:id` | yes | Hämta lista + glosor |
| PUT | `/api/lists/:id` | yes | Uppdatera lista |
| DELETE | `/api/lists/:id` | yes | Radera lista (kaskaderar glosor) |
| POST | `/api/lists/:id/glosor` | yes | Lägg till glosa |
| PUT | `/api/glosor/:id` | yes | Uppdatera glosa (även `stats`) |
| DELETE | `/api/glosor/:id` | yes | Radera glosa |
| POST | `/api/ai/generate-list` | yes | `{ topic, sourceLang, targetLang, count }` → listförslag |
| POST | `/api/ai/example-sentence` | yes | `{ word, lang }` → exempelmening |
| POST | `/api/ai/translate` | yes | `{ word, sourceLang, targetLang }` → översättning |

## Branch-konventioner

- `feat/<beskrivning>` — ny feature
- `fix/<beskrivning>` — buggfix
- `refactor/<beskrivning>` — refaktorering
- `docs/<beskrivning>` — bara dokumentation
- `chore/<beskrivning>` — tooling / deps

Aldrig commit direkt mot `main`. Öppna PR.

## Domän

Produktion körs på `glosan.jeklund.dev` via Traefik. Lägg in A-record som
pekar mot VM:en. Umami (om aktiv) ligger på `analytics.glosan.jeklund.dev`.

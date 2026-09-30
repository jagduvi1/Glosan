const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const McpToken = require('../models/McpToken');
const User = require('../models/User');
const { FEATURES, FEATURE_FIELDS, effectiveFeatures } = require('../config/features');
const { requireAuth } = require('../middleware/auth');
const { requireMcpAuth } = require('../middleware/mcpAuth');
const { handleMcpRequest } = require('../mcp/server');
const { issuer } = require('../services/mcpOAuth');

const router = express.Router();

// ── Limitrar för protokoll-endpointen ────────────────────────────────────────
// Hostade AI-connectors (claude.ai, ChatGPT) går ut från en liten delad
// IP-pool, så den globala per-IP-limitern skulle låta alla deras användare
// dela en hink. /api/mcp är därför undantagen i app.js och kör två egna lager:
//   1. mcpIpLimiter (FÖRE auth) — ett medvetet HÖGT tak per IP som bara
//      stoppar floder och token-gissning; oautentiserat skräp är ett billigt 401.
//   2. mcpUserLimiter (EFTER auth) — rättvisetaket, nycklat på VERIFIERAT
//      användar-id (inte token: tre anslutningar ska inte ge 3× budget).
// Antalet verktygsanrop per request och skrivbudgeten sköts i mcp/server.js.
const mcpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many MCP requests from this network — try again in a few minutes.' })
});
const mcpUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: 'This account has made too many MCP requests in a short time — wait a few minutes before retrying.'
  })
});

// RFC 9728 §5.1: ett oautentiserat anrop mot den skyddade resursen MÅSTE få
// 401 + WWW-Authenticate som pekar på protected-resource-metadatan, så att
// MCP-klienten hittar auktoriseringsservern och startar OAuth-flödet. Auth-
// middlewaren skickar 401:an själv, så vi patchar res.status och lägger på
// headern i samma ögonblick. BARA 401 — ett 403 betyder att credentialen är
// giltig men otillräcklig, och då hjälper ingen ny inloggning.
function mcpChallenge(req, res, next) {
  const prm = `${issuer()}/.well-known/oauth-protected-resource/api/mcp`;
  const origStatus = res.status.bind(res);
  res.status = (code) => {
    if (code === 401) res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${prm}", scope="read write"`);
    return origStatus(code);
  };
  next();
}

const guard = [mcpIpLimiter, mcpChallenge, requireMcpAuth, mcpUserLimiter];

// POST /api/mcp — stateless Streamable HTTP MCP-endpoint.
router.post('/', ...guard, async (req, res, next) => {
  try {
    // JSON-RPC-batchar togs bort ur MCP (2025-06-18) — och ett anrop med
    // hundra verktygsanrop skulle gå förbi limitrarna, som räknar HTTP-anrop.
    if (Array.isArray(req.body)) {
      return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported — send one JSON-RPC message per request.' } });
    }
    await handleMcpRequest(req, res, { user: req.user, scopes: req.mcpScopes, features: req.mcpFeatures || [] });
  } catch (err) {
    next(err);
  }
});

// Stateless: ingen session att öppna en SSE-ström för eller avsluta. Auth körs
// ändå först så en klient med en gammal token får 401 + discovery-pekaren.
router.get('/', ...guard, (req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'The Glosan MCP endpoint is stateless and POST-only.' });
});
router.delete('/', ...guard, (req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'The Glosan MCP endpoint is stateless — there is no session to terminate.' });
});

// ── Användarens egna AI-anslutningar (Profil-sidan) ─────────────────────────
// Bara JWT (requireAuth tar aldrig glo_-tokens): en ansluten AI kan inte lista
// eller koppla bort anslutningar — det gör användaren själv i webbappen.

function toConnection(t, current = []) {
  // Moduler kontot har men som anslutningen inte godkändes för (t.ex. Plugga
  // som slagits på efteråt) — profilsidan föreslår att ansluta igen.
  const missing = Array.isArray(t.modules) ? current.filter((k) => !t.modules.includes(k)) : [];
  return {
    id: String(t._id),
    name: t.name,
    scopes: t.scopes,
    missingModules: missing.map((k) => ({ key: k, label: FEATURES[k]?.label || k })),
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt
  };
}

// GET /api/mcp/connections — aktiva anslutningar, nyast först.
router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const [tokens, user] = await Promise.all([
      McpToken.find({ user: req.user.id, revokedAt: null }).sort({ createdAt: -1 }).lean(),
      User.findById(req.user.id, FEATURE_FIELDS).lean()
    ]);
    const current = effectiveFeatures(user);
    res.json({ connections: tokens.map((t) => toConnection(t, current)), endpoint: `${issuer()}/api/mcp` });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mcp/connections/:id — koppla bort en AI. Verkar direkt: nästa
// anrop med dess token (eller refresh) nekas.
router.delete('/connections/:id', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Anslutningen hittades inte.' });
    }
    const result = await McpToken.updateOne(
      { _id: req.params.id, user: req.user.id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Anslutningen hittades inte.' });
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

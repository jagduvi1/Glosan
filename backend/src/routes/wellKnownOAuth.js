const express = require('express');
const rateLimit = require('express-rate-limit');
const { authServerMetadata, protectedResourceMetadata } = require('../services/mcpOAuth');

// OAuth-discovery för MCP-connectorn. De här dokumenten MÅSTE ligga på
// originets /.well-known/ (RFC 8414 + RFC 9728), så routern monteras i appens
// ROT, före API-limitrarna. frontend/nginx.conf proxar de två sökvägarna hit —
// annars faller de igenom till SPA:ns index.html och varje anslutning dör i
// discovery-steget.

const router = express.Router();

// Generöst: en riktig klient hämtar discovery en gång per anslutning (och
// Cache-Control nedan håller borta upprepningar). Taket finns bara för att
// begränsa en loop mot en rot-sökväg som saknar annan limiter.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

function sendMeta(res, body) {
  // Publika, credential-fria dokument som hämtas av tredjepartsklienter.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(body);
}

// RFC 8414 — Authorization Server Metadata.
router.get('/oauth-authorization-server', (req, res) => sendMeta(res, authServerMetadata()));

// RFC 9728 — Protected Resource Metadata. Både den nakna sökvägen och
// varianten med resource-suffix (…/oauth-protected-resource/api/mcp) som en
// klient härleder från resource-URL:en.
router.get('/oauth-protected-resource', (req, res) => sendMeta(res, protectedResourceMetadata()));
router.get('/oauth-protected-resource/api/mcp', (req, res) => sendMeta(res, protectedResourceMetadata()));

module.exports = router;

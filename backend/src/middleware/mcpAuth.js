const McpToken = require('../models/McpToken');
const User = require('../models/User');
const { requireAuth } = require('./auth');
const { effectiveFeatures, FEATURE_FIELDS } = require('../config/features');

const { TOKEN_PREFIX, TOKEN_SCOPES } = McpToken;

// Hur ofta lastUsedAt skrivs per anslutning — annars blir varje MCP-anrop en
// DB-skrivning.
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Autentisering för /api/mcp. Tar två sorters Bearer:
 *
 * - `glo_…` — en OAuth-anslutning (claude.ai m.fl.). Sätter req.user +
 *   req.mcpToken ({ id, scopes }). Den här middlewaren är ENDA stället som
 *   accepterar glo_-tokens, och den sitter bara på MCP-endpointen — så en
 *   ansluten AI når aldrig REST-API:t, oavsett scope (RFC 8707-audience i
 *   praktiken).
 * - En vanlig JWT — användaren själv (t.ex. curl eller MCP Inspector med en
 *   access-token från webbappen). Får fulla scopes, precis som webbappen.
 *
 * Sätter även req.mcpFeatures (användarens effektiva funktionsflaggor), så att
 * verktyg för dolda moduler bara registreras för den som har flaggan. För en
 * glo_-anslutning bara de flaggor som också godkändes vid anslutningen
 * (McpToken.modules) — en modul som slås på senare kräver ett nytt samtycke.
 *
 * Fel svarar 401 så att MCP-klienten kör sin refresh-grant; routen lägger på
 * WWW-Authenticate-headern som pekar på discovery-dokumentet.
 */
async function requireMcpAuth(req, res, next) {
  const header = req.headers.authorization;
  const raw = header && header.startsWith('Bearer ') ? header.substring(7) : null;
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
    return requireAuth(req, res, async () => {
      try {
        const user = await User.findById(req.user.id).select(FEATURE_FIELDS).lean();
        if (!user) return res.status(401).json({ error: 'Invalid token' });
        req.mcpScopes = [...TOKEN_SCOPES];
        req.mcpFeatures = effectiveFeatures(user);
        next();
      } catch (err) {
        console.error('MCP JWT auth error:', err.message);
        res.status(500).json({ error: 'Authentication failed' });
      }
    });
  }

  try {
    const token = await McpToken.findOne({ tokenHash: McpToken.hashToken(raw), revokedAt: null });
    if (!token) return res.status(401).json({ error: 'Invalid token' });
    if (token.expiresAt.getTime() <= Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }
    const user = await User.findById(token.user).select(`roles ${FEATURE_FIELDS}`).lean();
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    req.user = {
      id: String(user._id),
      roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : ['user']
    };
    req.mcpToken = { id: String(token._id), scopes: token.scopes };
    req.mcpScopes = token.scopes;
    const current = effectiveFeatures(user);
    let approved = Array.isArray(token.modules) ? token.modules : null;
    if (!approved) {
      // Anslutning från före McpToken.modules: frys den till det den når nu.
      approved = current;
      McpToken.updateOne({ _id: token._id, modules: { $exists: false } }, { $set: { modules: current } }).catch(() => {});
    }
    req.mcpFeatures = current.filter((k) => approved.includes(k));

    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      McpToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }
    next();
  } catch (err) {
    console.error('MCP token auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = { requireMcpAuth, LAST_USED_THROTTLE_MS };

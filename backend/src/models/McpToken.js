const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * McpToken — en ansluten AI (claude.ai, Claude Desktop, ChatGPT …) som fått
 * access via OAuth-samtycket. Motsvarar Cellarions ApiToken med
 * origin:'oauth'; Glosan har inga personliga API-tokens, så modellen bär bara
 * OAuth-fallet.
 *
 * En rad = en ANSLUTNING. Access-token (`glo_…`, 1 h) och refresh-token
 * roteras på raden vid varje refresh; raden lever tills den återkallas.
 *
 * - Bara SHA-256 av tokens lagras. Hög entropi (256 bit) → en snabb hash
 *   räcker, bcrypt skulle kosta ~250 ms per MCP-anrop.
 * - Tokens gäller BARA /api/mcp (middleware/mcpAuth.js) — de når aldrig
 *   REST-API:t, oavsett scope.
 * - Återkallning är en mjuk flagga (revokedAt) så Profil kan visa den; alla
 *   rader raderas vid kontoradering.
 */
const TOKEN_PREFIX = 'glo_';
const TOKEN_SCOPES = ['read', 'write'];

const mcpTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  tokenHash: { type: String, required: true, unique: true },
  scopes: {
    type: [String],
    enum: TOKEN_SCOPES,
    required: true,
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length > 0,
      message: 'Token must have at least one scope'
    }
  },
  // Access-tokenens utgång. mcpAuth svarar 401 efter detta → klienten kör
  // sin refresh-grant.
  expiresAt: { type: Date, required: true },
  // SHA-256 av nuvarande refresh-token (roteras vid varje refresh, OAuth 2.1
  // §4.3.1).
  refreshTokenHash: { type: String, default: null },
  // SHA-256 av FÖRRA refresh-token. Dyker den upp igen är det en replay av en
  // förbrukad token = läckt → hela anslutningen återkallas (BCP §4.14.2).
  prevRefreshTokenHash: { type: String, default: null },
  oauthClientId: { type: String, required: true },
  // RFC 8707-audience (MCP-endpointens URL).
  resource: { type: String, default: null },
  // Throttlad till max en skrivning per timme av mcpAuth.
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null }
});

mcpTokenSchema.index({ refreshTokenHash: 1 }, { sparse: true });

mcpTokenSchema.statics.hashToken = function (raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
};
mcpTokenSchema.statics.generateToken = function () {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
};
// Refresh-token saknar prefix — den åker aldrig i Bearer-headern, bara till
// /token.
mcpTokenSchema.statics.generateRefreshToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = mongoose.model('McpToken', mcpTokenSchema);
module.exports.TOKEN_PREFIX = TOKEN_PREFIX;
module.exports.TOKEN_SCOPES = TOKEN_SCOPES;

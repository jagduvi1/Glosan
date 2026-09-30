const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * OAuthAuthCode — en engångs-auth-kod (RFC 6749 §4.1) som skapas på
 * POST /api/mcp/oauth/approve när den inloggade användaren godkänt, och byts
 * mot tokens på /token. Kortlivad och PKCE-bunden. Porterad från Cellarion.
 *
 * Bara SHA-256 av koden lagras; klartexten finns bara i redirecten tillbaka
 * till klienten. `consumedAt` gör den engångs. Koden är bunden till exakt en
 * klient + redirectUri + användare + scopes + resource, så inget av dem kan
 * bytas ut i token-steget. Raderas vid kontoradering.
 */
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

const oauthAuthCodeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  scopes: { type: [String], required: true },
  // Modulerna användaren hade när hen godkände (se McpToken.modules).
  modules: { type: [String], default: undefined },
  resource: { type: String, default: null },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

// TTL — ETT index på expiresAt (ett konkurrerande vanligt index på samma fält
// stänger tyst av TTL:en).
oauthAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

oauthAuthCodeSchema.statics.generateCode = function () {
  return crypto.randomBytes(32).toString('hex');
};
oauthAuthCodeSchema.statics.hashCode = function (raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

module.exports = mongoose.model('OAuthAuthCode', oauthAuthCodeSchema);
module.exports.AUTH_CODE_TTL_MS = AUTH_CODE_TTL_MS;

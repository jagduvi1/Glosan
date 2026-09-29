const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * OAuthClient — en OAuth 2.1-klient registrerad via Dynamic Client
 * Registration (RFC 7591) på POST /api/mcp/oauth/register. Så får claude.ai,
 * Claude Desktop, ChatGPT m.fl. ett `client_id` för MCP-connectorn utan manuell
 * setup. Porterad från Cellarion (models/OAuthClient.js).
 *
 * Registreringen är OAUTENTISERAD och sker innan någon användare loggat in, så
 * det finns ingen user-ref här — kopplingen till en användare görs först på
 * auth-koden och den utfärdade token. Raderna är därför inga personuppgifter
 * (connectorns namn + redirect-URI:er, inte en persons) och ingår varken i
 * GDPR-exporten eller i kontoraderingen.
 *
 * En klient ger INGENTING på egen hand — varje token kräver att en inloggad
 * användare godkänner på samtyckessidan. En spammad klientrad är inert.
 */
const oauthClientSchema = new mongoose.Schema({
  clientId: { type: String, required: true, unique: true },
  clientName: { type: String, default: null, maxlength: 200 },
  // Exakt-match-lista för redirect efter samtycke. Valideras vid registrering
  // (https eller loopback) och exakt-matchas på /authorize.
  redirectUris: { type: [String], required: true },
  // 'none' = publik klient (bara PKCE — claude.ai:s default).
  tokenEndpointAuthMethod: {
    type: String,
    enum: ['none', 'client_secret_post'],
    default: 'none'
  },
  // SHA-256 av klienthemligheten (bara konfidentiella klienter).
  clientSecretHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
  // Städa bort klienter som ALDRIG använts: sätts till nu+30d vid registrering
  // och tas bort (unset) första gången klienten byter en kod mot token, så en
  // aktiv connector blir kvar för alltid. TTL-at-date; null/saknad = aldrig.
  expiresAt: { type: Date, default: null }
});

oauthClientSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

oauthClientSchema.statics.generateClientId = function () {
  return 'mcpc_' + crypto.randomBytes(24).toString('hex');
};
oauthClientSchema.statics.generateClientSecret = function () {
  return crypto.randomBytes(32).toString('hex');
};
oauthClientSchema.statics.hashSecret = function (raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

module.exports = mongoose.model('OAuthClient', oauthClientSchema);

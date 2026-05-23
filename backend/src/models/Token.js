const mongoose = require('mongoose');

// Tokens för email-baserade flöden (verify-email, reset-password,
// magic-link). Tokenens råa värde finns aldrig i DB:n — vi lagrar
// bara SHA-256-hash av det. TTL-index på expiresAt rensar utgångna
// tokens automatiskt.
const tokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  kind: {
    type: String,
    enum: ['verify-email', 'reset-password', 'magic-link'],
    required: true
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  usedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// TTL-index — MongoDB rensar dokument automatiskt när expiresAt < now.
// expireAfterSeconds: 0 betyder "kör så snart expiresAt har passerats".
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Token', tokenSchema);

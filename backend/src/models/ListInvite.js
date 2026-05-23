const mongoose = require('mongoose');

// Multi-use invite-länk till en specifik lista. Användaren skapar en
// kod, klasskompisar scannar QR-koden, registrerar/loggar in, och
// får listan kopierad till sitt konto + blir vän med skaparen.
//
// Skiljer sig från InviteCode (engångskod för att bli vän):
// - kan användas flera gånger (upp till maxUses)
// - inkluderar list-referens som ska kopieras
// - TTL via expiresAt-fält (inte TTL-index — vi vill visa "går ut om
//   X dagar" i UI:t även när koden är aktiv)
const listInviteSchema = new mongoose.Schema({
  list: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlosList',
    required: true,
    index: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  maxUses: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  usedBy: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  revokedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hjälpare: är koden aktiv just nu?
listInviteSchema.methods.isActive = function () {
  if (this.revokedAt) return false;
  if (this.expiresAt < new Date()) return false;
  if (this.usedBy.length >= this.maxUses) return false;
  return true;
};

module.exports = mongoose.model('ListInvite', listInviteSchema);

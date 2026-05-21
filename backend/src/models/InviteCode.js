const mongoose = require('mongoose');

// Engångs-inbjudningskod för "lägg till en specifik kompis utan att hen
// kan sprida koden vidare". Skiljer sig från User.friendCode (permanent,
// publik) genom att:
//   * Den är 8 tecken (lägre kollisionsrisk + visuellt urskiljbar)
//   * Den går ut efter en kort tid (default 7 dagar)
//   * Den kan användas max en gång (markeras `usedBy` när den används)
//
// MongoDB TTL-index på expiresAt rensar oanvända koder automatiskt efter
// utgång; använda koder behålls (men funkar inte längre) som audit-spår.
const inviteCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// TTL: dokument raderas automatiskt 0 sekunder efter expiresAt. Vi sätter
// expiresAt långt fram för använda koder (eller behåller dem som de är —
// here med null hade vi blockat TTL). För enkelhet: använda koder skrivs
// inte över; de förfaller också vid expiresAt och försvinner då.
inviteCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('InviteCode', inviteCodeSchema);

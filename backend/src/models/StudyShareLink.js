const mongoose = require('mongoose');

/**
 * StudyShareLink — en delningslänk/QR-kod till ett område i Plugga
 * (`/p/<kod>`). Samma idé som ListInvite för glos-listor, med en viktig
 * skillnad: den som går med får INGEN kopia. Hen läggs till i områdets
 * `sharedWith`, så skaparens rättningar når alla direkt och var och en övar
 * med sin egen progress (StudyItemState är per användare).
 *
 * Kan användas flera gånger (upp till maxUses), går ut vid expiresAt och kan
 * stängas av (revokedAt). 30 dagar efter att den gått ut raderas den (TTL) —
 * usedBy säger vilka som gått med, och det behöver inte sparas för alltid.
 */
const studyShareLinkSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true, index: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  code: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, required: true, min: 1, max: 300 },
  usedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

studyShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

studyShareLinkSchema.methods.isActive = function (now = new Date()) {
  if (this.revokedAt) return false;
  if (this.expiresAt <= now) return false;
  return this.usedBy.length < this.maxUses;
};

module.exports = mongoose.model('StudyShareLink', studyShareLinkSchema);

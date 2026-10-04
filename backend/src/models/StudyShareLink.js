const mongoose = require('mongoose');

/**
 * StudyShareLink — en delningslänk/QR-kod till ett eller flera områden i
 * Plugga (`/p/<kod>`), t.ex. ett helt kapitel till en klass. Samma idé som
 * ListInvite för glos-listor: den som går med får en egen KOPIA av områdena
 * (sedan v0.1.38, services/study/copies.js) — och kan öppna länken igen för
 * att hämta det nya, utan att ta en plats till.
 *
 * Kan användas av upp till maxUses personer (usedBy), går ut vid expiresAt och
 * kan stängas av (revokedAt). En full länk fungerar fortfarande för dem som
 * redan använt den. 30 dagar efter att den gått ut raderas den (TTL) — usedBy
 * säger vilka som gått med, och det behöver inte sparas för alltid.
 */
const studyShareLinkSchema = new mongoose.Schema({
  // Området länken gäller — det första, när länken gäller flera.
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true, index: true },
  // Alla områden, för en länk till flera. Saknas på länkar till ett område
  // (som alla äldre länkar) — de gäller bara `unit`.
  units: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit' }], default: undefined, index: true },
  // Namnet mottagarna ser, t.ex. "Kapitel 4 — Procent" (skaparens text).
  title: { type: String, trim: true, maxlength: 100, default: '' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  code: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, required: true, min: 1, max: 300 },
  usedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

studyShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

/** Öppen: inte avstängd och inte utgången. Full är den när alla platser är tagna. */
studyShareLinkSchema.methods.isOpen = function (now = new Date()) {
  return !this.revokedAt && this.expiresAt > now;
};

studyShareLinkSchema.methods.isFull = function () {
  return this.usedBy.length >= this.maxUses;
};

/** Går att gå med via för någon ny (öppen och inte full). */
studyShareLinkSchema.methods.isActive = function (now = new Date()) {
  return this.isOpen(now) && !this.isFull();
};

module.exports = mongoose.model('StudyShareLink', studyShareLinkSchema);

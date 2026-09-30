const mongoose = require('mongoose');

/**
 * StudyItemDeletion — historik över borttagna kort och övningar i ett område:
 * vad som togs bort (en kopia av uppgiften som den var), när, av vem och om
 * det gjordes i appen eller av användarens AI. Visas under "Borttaget" på
 * områdessidan, där skaparen kan ångra, och i get_study_unit så AI:n inte
 * skapar samma dåliga uppgift igen.
 *
 * Uppgiftsnummer återanvänds aldrig, så en återställd uppgift får tillbaka
 * sin gamla kod (MA2-7) — och sitt gamla id, så svarshistoriken hänger ihop.
 */
const studyItemDeletionSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true, index: true },
  // Områdets skapare (den som kan ångra).
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  item: { type: mongoose.Schema.Types.ObjectId, required: true },
  code: { type: String, maxlength: 12, default: '' },
  kind: { type: String, enum: ['card', 'exercise'], required: true },
  usage: { type: String, enum: ['practice', 'test'], default: 'practice' },
  // Uppgiften som den såg ut (utan _id) — det som behövs för att visa och återställa den.
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  via: { type: String, enum: ['app', 'ai'], required: true },
  deletedAt: { type: Date, default: Date.now },
  restoredAt: { type: Date, default: null }
});

studyItemDeletionSchema.index({ unit: 1, deletedAt: -1 });

module.exports = mongoose.model('StudyItemDeletion', studyItemDeletionSchema);

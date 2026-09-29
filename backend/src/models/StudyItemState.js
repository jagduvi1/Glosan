const mongoose = require('mongoose');

/**
 * StudyItemState — EN användares progress på ETT kort/en övning (spaced
 * repetition). Separat från StudyItem så att ett delat område ger varje
 * användare egen statistik.
 *
 * Leitner-lådor: 0 = ny, 1–5 = hur väl den sitter. Rätt → upp en låda, fel →
 * tillbaka till 1. dueAt = när den ska komma tillbaka (1, 2, 4, 8, 16 dagar).
 */
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];

const studyItemStateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem', required: true },
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
  box: { type: Number, min: 0, max: 5, default: 0 },
  dueAt: { type: Date, default: null },
  correct: { type: Number, min: 0, default: 0 },
  wrong: { type: Number, min: 0, default: 0 },
  lastResult: { type: String, enum: ['correct', 'partial', 'wrong', null], default: null },
  lastSeenAt: { type: Date, default: null }
});

studyItemStateSchema.index({ user: 1, item: 1 }, { unique: true });
studyItemStateSchema.index({ user: 1, unit: 1 });
studyItemStateSchema.index({ user: 1, dueAt: 1 });
studyItemStateSchema.index({ unit: 1 });

module.exports = mongoose.model('StudyItemState', studyItemStateSchema);
module.exports.BOX_INTERVAL_DAYS = BOX_INTERVAL_DAYS;

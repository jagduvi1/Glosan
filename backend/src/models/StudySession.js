const mongoose = require('mongoose');
const { SUBJECT_KEYS } = require('../config/subjects');

/**
 * StudySession — ett pluggpass: övningar, repetition, prov, läsning av en
 * genomgång eller en papperslösning. Grunden för "hur mycket har jag
 * pluggat" på sidan "Min plugg" (idag/vecka/månad/termin, per ämne).
 *
 * Aktiv tid räknas på servern: varje svar eller "ping" (medan en genomgång är
 * synlig) lägger till tiden sedan förra aktiviteten, men högst
 * ACTIVE_GAP_CAP_SEC — en skärm som står och lyser räknas inte som plugg.
 */
const ACTIVE_GAP_CAP_SEC = 120;

const studySessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['practice', 'review', 'test', 'reading', 'paper'], required: true },
  units: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit' }],
  subjects: [{ type: String, enum: SUBJECT_KEYS }],
  startedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  activeSeconds: { type: Number, min: 0, default: 0 },
  answered: { type: Number, min: 0, default: 0 },
  correct: { type: Number, min: 0, default: 0 }
});

studySessionSchema.index({ user: 1, startedAt: -1 });

/** Sekunder att lägga till för en aktivitet vid `now` (tak: ACTIVE_GAP_CAP_SEC). */
studySessionSchema.statics.activeIncrement = function (lastActiveAt, now = new Date()) {
  const gap = (new Date(now).getTime() - new Date(lastActiveAt).getTime()) / 1000;
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return Math.round(Math.min(gap, ACTIVE_GAP_CAP_SEC));
};

module.exports = mongoose.model('StudySession', studySessionSchema);
module.exports.ACTIVE_GAP_CAP_SEC = ACTIVE_GAP_CAP_SEC;

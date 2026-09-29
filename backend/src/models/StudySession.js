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
  correct: { type: Number, min: 0, default: 0 },
  // Uppgifterna passet delade ut och de som besvarats: ett svar räknas bara
  // på en utdelad uppgift, och bara en gång (annars gick XP att farma).
  // Nivåstegen delar ut via ladder.served.
  served: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }], default: undefined },
  answeredItems: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }], default: undefined },
  // Nivåstegen (services/study/ladder.js): aktuell nivå, rätt/fel i rad,
  // högsta nivå hittills, hur många svar passet har, uppgifterna per nivå i
  // turordning och vilka som redan visats. Saknas för vanliga pass.
  ladder: {
    type: new mongoose.Schema({
      level: { type: String, enum: ['E', 'C', 'A'], required: true },
      up: { type: Number, min: 0, default: 0 },
      down: { type: Number, min: 0, default: 0 },
      reached: { type: String, enum: ['E', 'C', 'A'], required: true },
      count: { type: Number, min: 1, max: 50, default: 15 },
      pools: {
        E: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }],
        C: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }],
        A: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }]
      },
      served: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem' }]
    }, { _id: false }),
    default: undefined
  }
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

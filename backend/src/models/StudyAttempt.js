const mongoose = require('mongoose');
const { SUBJECT_KEYS } = require('../config/subjects');

/**
 * StudyAttempt — ett svar på ett kort eller en övning. Historiken bakom
 * statistik, "öva på det du gjort fel" och sidan "Min plugg" (vad eleven har
 * gjort idag/vecka/månad — att visa för föräldrar).
 *
 * `source: 'paper'` = eleven löste uppgiften på papper, fotade den och lät sin
 * egen AI rätta via MCP; AI:ns återkoppling sparas i `feedback` så eleven kan
 * läsa tipsen igen. Fotot sparas aldrig.
 *
 * subject/unitTitle/itemCode är avsiktligt denormaliserade: historiken ska gå
 * att läsa även om ett delat område senare raderas av sin skapare.
 */
const studyAttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem', required: true },
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'StudySession', default: null },
  subject: { type: String, enum: SUBJECT_KEYS, required: true },
  unitTitle: { type: String, maxlength: 120, default: '' },
  itemCode: { type: String, maxlength: 12, default: '' },
  source: { type: String, enum: ['app', 'paper'], default: 'app' },
  mode: { type: String, enum: ['practice', 'review', 'test'], default: 'practice' },
  result: { type: String, enum: ['correct', 'partial', 'wrong'], required: true },
  given: { type: String, maxlength: 500, default: '' },
  feedback: { type: String, maxlength: 4000, default: '' },
  createdAt: { type: Date, default: Date.now }
});

studyAttemptSchema.index({ user: 1, createdAt: -1 });
studyAttemptSchema.index({ user: 1, unit: 1 });
studyAttemptSchema.index({ item: 1 });

module.exports = mongoose.model('StudyAttempt', studyAttemptSchema);

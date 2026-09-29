const mongoose = require('mongoose');

/**
 * StudyItem — något man TRÄNAR på i ett område: ett kort (`card`) eller en
 * övning (`exercise`). En gemensam modell så att blandade pass, statistik,
 * felrapporter och MCP:s ändra/radera-verktyg fungerar likadant för båda.
 *
 * Innehållet ägs av områdets skapare. Progress per användare ligger i
 * StudyItemState — INTE här — så att delade områden ger alla egen statistik.
 *
 * `number` är löpnumret i området; tillsammans med områdets kod blir det
 * uppgiftskoden eleven skriver på pappret ("MA3-14", utils/studyCodes.js).
 *
 * Svarstyper (exercise):
 *   number  — ett tal, med tolerans och ev. enhet ("3,5", "7/2", "12 cm")
 *   choice  — flerval, ett rätt alternativ
 *   text    — kort svar med godkända varianter ("fotosyntes")
 *   self    — öppen fråga ("förklara…", "visa hur…"): eleven jämför med
 *             modellsvaret — eller fotar sin lösning och låter sin egen AI
 *             rätta via MCP. Glosan anropar aldrig någon AI själv.
 */
const ANSWER_TYPES = ['number', 'choice', 'text', 'self'];
const LEVELS = ['E', 'C', 'A'];

const answerSchema = new mongoose.Schema({
  type: { type: String, enum: ANSWER_TYPES, required: true },
  value: { type: Number },
  tolerance: { type: Number, min: 0, default: 0 },
  unit: { type: String, trim: true, maxlength: 20, default: '' },
  choices: { type: [{ type: String, trim: true, maxlength: 300 }], default: undefined },
  correctIndex: { type: Number },
  accepted: { type: [{ type: String, trim: true, maxlength: 200 }], default: undefined },
  // Modellsvar — krävs för `self`, valfritt för övriga (visas efter svar).
  modelAnswer: { type: String, maxlength: 4000, default: '' }
}, { _id: false });

const studyItemSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  number: { type: Number, required: true, min: 1 },
  kind: { type: String, enum: ['card', 'exercise'], required: true },
  // 'test' = provfråga: visas inte i vanliga pass, så provet inte avslöjas.
  usage: { type: String, enum: ['practice', 'test'], default: 'practice' },
  prompt: { type: String, required: true, trim: true, maxlength: 4000 },
  back: { type: String, trim: true, maxlength: 4000, default: '' },
  answer: { type: answerSchema, default: undefined },
  hints: {
    type: [{ type: String, trim: true, maxlength: 1000 }],
    default: [],
    validate: { validator: (a) => a.length <= 5, message: 'at most 5 hints' }
  },
  solution: { type: String, maxlength: 8000, default: '' },
  level: { type: String, enum: [...LEVELS, null], default: null },
  skill: { type: String, trim: true, maxlength: 80, default: '' },
  // Bokens uppgift som förebild, t.ex. "uppg 3.14" — så eleven hittar den.
  sourceRef: { type: String, trim: true, maxlength: 60, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studyItemSchema.index({ unit: 1, number: 1 }, { unique: true });

// Regler som beror på typen — fångas här så att ett trasigt kort eller en
// övning utan facit aldrig hamnar i databasen, hur den än skapas.
studyItemSchema.pre('validate', function (next) {
  if (this.kind === 'card') {
    if (!this.back || !this.back.trim()) this.invalidate('back', 'a card needs a back side');
    return next();
  }
  const a = this.answer;
  if (!a || !a.type) {
    this.invalidate('answer', 'an exercise needs an answer');
    return next();
  }
  if (a.type === 'number' && !Number.isFinite(a.value)) {
    this.invalidate('answer.value', 'a number answer needs a finite value');
  }
  if (a.type === 'choice') {
    const n = Array.isArray(a.choices) ? a.choices.length : 0;
    if (n < 2 || n > 8) this.invalidate('answer.choices', 'a choice question needs 2–8 choices');
    else if (!Number.isInteger(a.correctIndex) || a.correctIndex < 0 || a.correctIndex >= n) {
      this.invalidate('answer.correctIndex', 'correctIndex must point at one of the choices');
    }
  }
  if (a.type === 'text' && !(Array.isArray(a.accepted) && a.accepted.some((s) => s && s.trim()))) {
    this.invalidate('answer.accepted', 'a text answer needs at least one accepted answer');
  }
  if (a.type === 'self' && !(a.modelAnswer && a.modelAnswer.trim())) {
    this.invalidate('answer.modelAnswer', 'an open question needs a model answer');
  }
  next();
});

studyItemSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('StudyItem', studyItemSchema);
module.exports.ANSWER_TYPES = ANSWER_TYPES;
module.exports.LEVELS = LEVELS;

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
 *   multi   — flerval med flera rätta ("Vilka av talen är primtal?")
 *   order   — ordna alternativen (`choices` i RÄTT ordning; appen blandar dem)
 *   factors — faktorer i valfri ordning ("Primtalsfaktorisera 90" → 2·3·3·5)
 */
const ANSWER_TYPES = ['number', 'choice', 'text', 'self', 'multi', 'order', 'factors'];
const LEVELS = ['E', 'C', 'A'];

const answerSchema = new mongoose.Schema({
  type: { type: String, enum: ANSWER_TYPES, required: true },
  value: { type: Number },
  // Mallövning: svaret räknas fram per instans (services/study/templates.js).
  expr: { type: String, trim: true, maxlength: 200, default: undefined },
  tolerance: { type: Number, min: 0, default: 0 },
  unit: { type: String, trim: true, maxlength: 20, default: '' },
  choices: { type: [{ type: String, trim: true, maxlength: 300 }], default: undefined },
  correctIndex: { type: Number },
  correctIndices: { type: [Number], default: undefined },
  factors: { type: [Number], default: undefined },
  accepted: { type: [{ type: String, trim: true, maxlength: 200 }], default: undefined },
  // Textsvar: inget stavfel godtas (etanol/metanol, Karl XI/XII).
  exact: { type: Boolean, default: undefined },
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
  // Mall: nya tal varje gång ({ vars: [...], where: [...] }) — se
  // services/study/templates.js. Kontrolleras när AI:n skapar övningen.
  template: { type: mongoose.Schema.Types.Mixed, default: undefined },
  // I en kopia: originaluppgiften (först i kedjan av kopior, services/study/copies.js).
  copiedFrom: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  // ... och vem som skrev originalet (för blockeringar, även om originalet tagits bort).
  copyAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
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
  if (a.type === 'number' && !Number.isFinite(a.value) && !(a.expr && this.template)) {
    this.invalidate('answer.value', 'a number answer needs a finite value (or, in a template, an expr)');
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
  if (a.type === 'multi') {
    const n = Array.isArray(a.choices) ? a.choices.length : 0;
    const idx = Array.isArray(a.correctIndices) ? a.correctIndices : [];
    if (n < 2 || n > 8) this.invalidate('answer.choices', 'a multi-answer question needs 2–8 choices');
    else if (!idx.length || new Set(idx).size !== idx.length || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) {
      this.invalidate('answer.correctIndices', 'correctIndices must list the correct choices, each once');
    }
  }
  if (a.type === 'order') {
    const items = Array.isArray(a.choices) ? a.choices.map((c) => String(c).trim().toLowerCase()) : [];
    if (items.length < 3 || items.length > 8) this.invalidate('answer.choices', 'an order question needs 3–8 items');
    else if (new Set(items).size !== items.length) this.invalidate('answer.choices', 'the items to order must all be different');
  }
  if (a.type === 'factors') {
    const f = Array.isArray(a.factors) ? a.factors : [];
    if (!f.length || f.length > 30 || f.some((x) => !Number.isInteger(x) || x < 2 || x > 1e9)) {
      this.invalidate('answer.factors', 'factors must be 1–30 whole numbers of at least 2');
    }
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

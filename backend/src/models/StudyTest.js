const mongoose = require('mongoose');

/**
 * StudyTest — ett övningsprov i ett område, skapat av användarens AI via MCP
 * (create_practice_test). Frågorna är vanliga StudyItems med usage 'test'
 * (de syns inte i vanliga pass, så provet inte avslöjas) och har koder som
 * alla andra uppgifter (MA3-31), så provet kan göras på papper och rättas av
 * AI:n. Varje fråga ger poäng på nivåerna E/C/A som på de nationella proven;
 * betygsgränserna räknas ut när provet skapas (services/study/testGrading.js).
 */
const pointsSchema = new mongoose.Schema({
  E: { type: Number, min: 0, max: 10, default: 0 },
  C: { type: Number, min: 0, max: 10, default: 0 },
  A: { type: Number, min: 0, max: 10, default: 0 }
}, { _id: false });

const limitSchema = new mongoose.Schema({
  total: { type: Number, min: 0, default: 0 },
  cOrA: { type: Number, min: 0, default: 0 },
  a: { type: Number, min: 0, default: 0 }
}, { _id: false });

const questionSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem', required: true },
  points: { type: pointsSchema, required: true },
  // Provdel, t.ex. "Del A — utan miniräknare" (som på de nationella proven).
  part: { type: String, trim: true, maxlength: 60, default: '' }
}, { _id: false });

const studyTestSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  timeLimitMin: { type: Number, min: 5, max: 180, default: null },
  questions: {
    type: [questionSchema],
    validate: { validator: (a) => a.length >= 1 && a.length <= 40, message: 'a test has 1–40 questions' }
  },
  gradeLimits: {
    E: { type: limitSchema, default: () => ({}) },
    D: { type: limitSchema, default: () => ({}) },
    C: { type: limitSchema, default: () => ({}) },
    B: { type: limitSchema, default: () => ({}) },
    A: { type: limitSchema, default: () => ({}) }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studyTestSchema.index({ 'questions.item': 1 });

studyTestSchema.pre('validate', function (next) {
  (this.questions || []).forEach((q, i) => {
    const p = q.points || {};
    if ((p.E || 0) + (p.C || 0) + (p.A || 0) < 1) this.invalidate(`questions.${i}.points`, 'every question gives at least 1 point');
  });
  next();
});

studyTestSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('StudyTest', studyTestSchema);

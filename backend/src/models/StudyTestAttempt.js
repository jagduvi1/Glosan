const mongoose = require('mongoose');
const { SUBJECT_KEYS } = require('../config/subjects');

/**
 * StudyTestAttempt — ett försök på ett övningsprov: i appen (rättas på
 * servern; öppna frågor bedömer eleven själv mot modellsvaret) eller på
 * papper (eleven fotar provet och hens AI rättar via MCP, record_paper_test).
 *
 * status: in_progress → (awaiting_self om provet har öppna frågor) → done.
 * Titel, ämne och frågekoder är denormaliserade: resultatet ska gå att läsa
 * även om provet eller området senare raderas.
 */
const pointsSchema = new mongoose.Schema({
  E: { type: Number, min: 0, default: 0 },
  C: { type: Number, min: 0, default: 0 },
  A: { type: Number, min: 0, default: 0 },
  total: { type: Number, min: 0, default: 0 }
}, { _id: false });

const answerSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem', required: true },
  code: { type: String, maxlength: 12, default: '' },
  given: { type: String, maxlength: 500, default: '' },
  // null = öppen fråga som väntar på elevens självbedömning
  result: { type: String, enum: ['correct', 'partial', 'wrong', null], default: null },
  selfLevel: { type: String, enum: ['none', 'E', 'C', 'A', null], default: null },
  points: { type: pointsSchema, default: () => ({}) },
  max: { type: pointsSchema, default: () => ({}) },
  feedback: { type: String, maxlength: 4000, default: '' }
}, { _id: false });

const studyTestAttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  test: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyTest', required: true },
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'StudySession', default: null },
  source: { type: String, enum: ['app', 'paper'], default: 'app' },
  status: { type: String, enum: ['in_progress', 'awaiting_self', 'done'], default: 'in_progress' },
  subject: { type: String, enum: SUBJECT_KEYS, required: true },
  unitTitle: { type: String, maxlength: 120, default: '' },
  testTitle: { type: String, maxlength: 120, default: '' },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  answers: { type: [answerSchema], default: [] },
  score: { type: pointsSchema, default: () => ({}) },
  max: { type: pointsSchema, default: () => ({}) },
  grade: { type: String, enum: ['A', 'B', 'C', 'D', 'E', 'F', null], default: null },
  overallFeedback: { type: String, maxlength: 4000, default: '' },
  xpEarned: { type: Number, min: 0, default: 0 }
});

studyTestAttemptSchema.index({ user: 1, test: 1, startedAt: -1 });
studyTestAttemptSchema.index({ user: 1, finishedAt: -1 });
studyTestAttemptSchema.index({ test: 1 });

module.exports = mongoose.model('StudyTestAttempt', studyTestAttemptSchema);

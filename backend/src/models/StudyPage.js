const mongoose = require('mongoose');

/**
 * StudyPage — en "Genomgång" i ett område: förklaring, "så gör du" steg för
 * steg, exempel och vanliga fel. Markdown med formler i LaTeX ($…$), skriven
 * av AI:n via MCP. Renderas utan rå HTML (se frontend) — texten kommer från en
 * AI och ska aldrig kunna bli körbar kod i appen.
 */
const studyPageSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  body: { type: String, required: true, maxlength: 20000 },
  order: { type: Number, default: 0 },
  // I en kopia: originalsidan (först i kedjan av kopior, services/study/copies.js).
  copiedFrom: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  // ... och vem som skrev originalet (för blockeringar, även om originalet tagits bort).
  copyAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  // ... och vilka som ändrat det sedan, i en kopia (de räknas också som författare).
  copyEditors: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: undefined },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studyPageSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('StudyPage', studyPageSchema);

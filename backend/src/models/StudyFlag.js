const mongoose = require('mongoose');

/**
 * StudyFlag — "Rapportera fel i facit". En elev (skaparen själv eller en
 * kompis som fått området delat) markerar ett kort eller en övning som fel.
 * AI-skrivet facit kan ha fel, så rapporterna går till SKAPAREN: skaparens AI
 * listar dem via MCP (list_study_flags), rättar uppgiften och stänger
 * rapporten (resolve_study_flag).
 */
const studyFlagSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyItem', required: true },
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
  // Områdets skapare — den som kan rätta.
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolutionNote: { type: String, trim: true, maxlength: 500, default: '' },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

studyFlagSchema.index({ owner: 1, status: 1 });
studyFlagSchema.index({ unit: 1 });
studyFlagSchema.index({ reporter: 1 });

module.exports = mongoose.model('StudyFlag', studyFlagSchema);

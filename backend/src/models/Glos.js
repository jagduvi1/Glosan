const mongoose = require('mongoose');

const glosSchema = new mongoose.Schema({
  list: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlosList',
    required: true,
    index: true
  },
  source: {
    type: String,
    required: [true, 'Source word is required'],
    trim: true,
    maxlength: [200, 'Source too long']
  },
  target: {
    type: String,
    required: [true, 'Target word is required'],
    trim: true,
    maxlength: [200, 'Target too long']
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes too long'],
    default: ''
  },
  exampleSentence: {
    type: String,
    trim: true,
    maxlength: [500, 'Example sentence too long'],
    default: ''
  },
  // True for glosor the user added as "extras" (e.g. AI suggestions on the
  // same theme as the homework) — not part of what they need to memorise.
  extra: { type: Boolean, default: false },
  stats: {
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    lastReviewedAt: { type: Date, default: null }
  },
  createdAt: { type: Date, default: Date.now }
});

// Index för repetitionsläget — vi sorterar/filtrerar på lastReviewedAt
// när vi plockar fram glosor som inte övats på ett tag. Utan index blir
// query:n O(n) per lista.
glosSchema.index({ list: 1, 'stats.lastReviewedAt': 1 });

module.exports = mongoose.model('Glos', glosSchema);

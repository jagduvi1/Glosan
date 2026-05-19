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
  stats: {
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    lastReviewedAt: { type: Date, default: null }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Glos', glosSchema);

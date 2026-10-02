const mongoose = require('mongoose');

const glosListSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title too long']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description too long'],
    default: ''
  },
  sourceLang: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [10, 'Language code too long'],
    default: 'sv'
  },
  targetLang: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [10, 'Language code too long'],
    default: 'en'
  },
  // When true, the practice modes show the target word and ask for the source
  // (e.g. show "huset" → type "the house"). Default is true since most users
  // study from their native language toward the language they're learning.
  quizReversed: { type: Boolean, default: true },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },
  // Kompisar som ägaren har delat listan med. Ger läsbar access + möjlighet
  // att köra quiz för egen XP.
  sharedWith: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  // Vem som lade till vem — alla som ser en lista kan dela den vidare. Den som
  // fått listan av någon annan än ägaren ser den personen som "Delad av",
  // aldrig ägarens namn. Saknas raden har ägaren delat (äldre delningar).
  sharedVia: [{
    _id: false,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  // 'read' = bara ägaren får ändra glosor. 'edit' = även mottagare får
  // lägga till och radera glosor. Titel, kategori, riktning och radering
  // av hela listan är alltid bara ägarens. Per-glos-mastery (stats.correct/
  // wrong) och listans bestScore räknas alltid till ägaren — mottagare som
  // vill ha egna stats kopierar listan istället.
  shareMode: { type: String, enum: ['read', 'edit'], default: 'read' },
  bestScore: {
    correct: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    achievedAt: { type: Date }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

glosListSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('GlosList', glosListSchema);
// Tak per konto — mer än nog för en hel skolgång, och stoppar en AI i loop.
module.exports.MAX_LISTS_PER_USER = 1000;

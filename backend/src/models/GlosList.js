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
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

glosListSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('GlosList', glosListSchema);

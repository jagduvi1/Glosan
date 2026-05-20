const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [60, 'Name too long']
  },
  // Optional palette color key — frontend draws a coloured dot for the category.
  // Allowed values match our palette tokens.
  color: {
    type: String,
    enum: ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry', null],
    default: null
  },
  createdAt: { type: Date, default: Date.now }
});

categorySchema.index({ user: 1, name: 1 });

module.exports = mongoose.model('Category', categorySchema);

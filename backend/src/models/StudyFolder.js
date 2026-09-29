const mongoose = require('mongoose');

/**
 * StudyFolder — en "Mapp" i Plugga: elevens egen gruppering av områden tvärs
 * över ämnen och terminer ("Inför provet v. 42"). Kan innehålla både egna och
 * delade områden. Skiljer sig medvetet från glos-listornas Category.
 */
const studyFolderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  color: { type: String, enum: ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry', null], default: null },
  units: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit' }],
    default: [],
    validate: { validator: (a) => a.length <= 200, message: 'at most 200 units per folder' }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studyFolderSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('StudyFolder', studyFolderSchema);

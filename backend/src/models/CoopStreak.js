const mongoose = require('mongoose');

// Gemensam streak mellan två kompisar. `users` är alltid sorterat på
// stigande ObjectId-strängar, så vi kan ha ett unikt index på paret och
// slipper dubletter (A↔B vs B↔A).
//
// Streaken tickas upp när BÅDA har kört minst en quiz samma dag. Bryter
// (current=1) om paret inte var båda aktiva igår vid nästa båda-aktiva-dag.
const coopStreakSchema = new mongoose.Schema({
  users: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    validate: [(arr) => Array.isArray(arr) && arr.length === 2, 'users måste vara exakt 2 IDs']
  },
  current: { type: Number, default: 0, min: 0 },
  longest: { type: Number, default: 0, min: 0 },
  lastBothActiveDay: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Unique sorted pair index — hindrar dubletter oavsett vem som startade.
coopStreakSchema.index({ users: 1 }, { unique: true });

// Helper: normalisera ett par av user-IDs till sorterad array. Använd alltid
// detta innan create/find så vi får determministisk ordning.
coopStreakSchema.statics.sortedPair = function (a, b) {
  const ids = [String(a), String(b)].sort();
  return ids.map((id) => new mongoose.Types.ObjectId(id));
};

module.exports = mongoose.model('CoopStreak', coopStreakSchema);

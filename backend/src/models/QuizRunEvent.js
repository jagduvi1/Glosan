const mongoose = require('mongoose');

// Event-logg för avslutade quiz-rundor. Loggas av /api/me/quiz-complete
// så vi kan aggregera "veckans bästa per lista" mellan ägaren och alla
// som listan är delad med — utan att förorena listans `bestScore` med
// mottagar-data.
const quizRunEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  list: { type: mongoose.Schema.Types.ObjectId, ref: 'GlosList', required: true },
  correct: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 1 },
  ratio: { type: Number, required: true, min: 0, max: 1 },
  createdAt: { type: Date, default: Date.now }
});

// Sammansatta index för veckorekord-aggregeringen.
quizRunEventSchema.index({ list: 1, createdAt: -1 });
quizRunEventSchema.index({ user: 1, createdAt: -1 });
// Compound (list, user, createdAt) — exakt vad lists.js weekly-records
// aggregation matchar/sorterar på. Snabbar upp aggregat när historik växer.
quizRunEventSchema.index({ list: 1, user: 1, createdAt: -1 });

// TTL: 60 dagar — bara senaste veckan används av "veckans rekord", men vi
// håller två månader så att en användare kan se tillbaka på "senaste
// månadens utveckling" om vi nån gång lägger till den vyn.
quizRunEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports = mongoose.model('QuizRunEvent', quizRunEventSchema);

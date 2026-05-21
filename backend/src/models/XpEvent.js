const mongoose = require('mongoose');

// Event-logg för XP-tjänande. Loggas av /api/me/quiz-complete varje gång
// en användare får XP, så vi kan aggregera "denna månad" / "denna vecka"
// utan att förlita oss på user.xp som bara har totalen.
const xpEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
  sourceLang: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// Sammansatt index för "alla mina events de senaste N dagar" — vanligaste
// query när vi aggregerar månads-leaderboard.
xpEventSchema.index({ user: 1, createdAt: -1 });

// TTL: 365 dagar. Vi använder bara events för månads/vecko-leaderboards
// + ev. årsöversikt, så äldre än ett år är dödvikt.
xpEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

module.exports = mongoose.model('XpEvent', xpEventSchema);

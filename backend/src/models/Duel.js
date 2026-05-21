const mongoose = require('mongoose');

// Async-duell på en specifik lista. Glos-urvalet + riktningen lottas vid
// skapandet och sparas på Duel-dokumentet, så alla deltagare får exakt samma
// frågor i samma ordning oavsett när de spelar. Resultatet jämförs på flest
// rätt och tie-break på snabbast tid.
const participantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  correct: { type: Number, default: 0, min: 0 },
  total: { type: Number, default: 0, min: 0 },
  durationMs: { type: Number, default: 0, min: 0 },
  completedAt: { type: Date, default: null }
}, { _id: false });

const duelSchema = new mongoose.Schema({
  // 'duel' = slumpade frågor från en hel lista, vinnare = flest rätt.
  // 'goal' = handplockade glosor från en eller flera listor, mål att klara.
  // 'live' = realtidsduell över WebSocket; båda spelar samtidigt och först
  //          rätt på varje fråga får poängen.
  kind: { type: String, enum: ['duel', 'goal', 'live'], default: 'duel' },
  // För live: när första spelaren joinade ↔ när invitation går ut (24h).
  // Auto-rensas av TTL-index för att slippa skräp.
  liveExpiresAt: { type: Date, default: null },
  // En "goal"-utmaning kan blanda glosor från flera listor, så list får
  // vara null. För 'duel' krävs den.
  list: { type: mongoose.Schema.Types.ObjectId, ref: 'GlosList', default: null, index: true },
  // För kind='goal': antal rätt som krävs för att lyckas. Null = ingen mål.
  goal: { type: Number, default: null, min: 0 },
  // Valfri rubrik på utmaningen ("V20-läxan", "Hård test"). Bara goal-typer
  // sätter denna; duels får list-titeln som rubrik via populate.
  title: { type: String, default: '', maxlength: 100, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Frigjorda fält för glos-frågorna så vi inte beror på att glos-listan är
  // intakt vid spel-tid: en raderad glosa skulle annars få en deltagare att
  // få "ej tillgänglig". `glosId` är referens för stats, `source`/`target`/
  // `notes` lagras inline för att garantera samma fråga till alla.
  questions: [{
    glosId: { type: mongoose.Schema.Types.ObjectId, ref: 'Glos' },
    source: String,
    target: String,
    notes: String
  }],
  // Vilken riktning som lottades — true = visa target, gissa source (vanligast).
  reversed: { type: Boolean, default: true },
  participants: [participantSchema],
  createdAt: { type: Date, default: Date.now, index: true }
});

// Snabb sökning av "mina duels" via participant-user.
duelSchema.index({ 'participants.user': 1, createdAt: -1 });
// TTL för live-duels som aldrig accepterades — försvinner vid liveExpiresAt.
duelSchema.index({ liveExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Duel', duelSchema);

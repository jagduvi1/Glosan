const Duel = require('../models/Duel');

// In-memory state per pågående live-duel. Process-lokalt — för en singel-
// nod räcker det. Vid skalning över flera noder behöver man Redis-adapter.
//
// state[duelId] = {
//   players: Map<userId, socketId>,
//   ready: Set<userId>,
//   scores: Map<userId, number>,
//   currentIdx: number,
//   roundAnswered: Set<userId>, // som svarat denna runda
//   questions: [...],            // snapshot från Duel-dokumentet
//   reversed: boolean,
//   durationStart: number        // performance.now() ekvivalent
// }
const games = new Map();

const QUESTION_REVEAL_MS = 1000;     // kort countdown innan första fråga
const ROUND_TIMEOUT_MS = 15000;       // efter X sekunder utan svar → ingen får poäng
const BETWEEN_ROUNDS_MS = 1500;       // paus mellan rundor för att läsa feedback

function expectedFor(q, reversed) {
  return reversed ? q.source : q.target;
}
function promptFor(q, reversed) {
  return reversed ? q.target : q.source;
}

// Mjuk svarsmatchning: trimma + lowercase + slash-varianter. Vi importerar
// inte frontend's quiz.js, men replikerar samma logik här.
function answerMatches(given, expected) {
  if (!given || !expected) return false;
  const g = given.trim().toLowerCase();
  const tokens = expected.trim().split(/\s+/);
  const perToken = tokens.map((t) => t.split('/').map((s) => s.trim()).filter(Boolean));
  const variants = perToken
    .reduce((acc, opts) => acc.flatMap((prefix) => opts.map((opt) => [...prefix, opt])), [[]])
    .map((parts) => parts.join(' ').toLowerCase());
  return variants.includes(g);
}

function maskQuestion(q, reversed) {
  // Skickar bara promptdelen till klienten — det förväntade svaret behålls
  // serversidan så användaren inte kan inspektera nätverket för svaret.
  return {
    glosId: q.glosId,
    prompt: promptFor(q, reversed),
    notes: q.notes || ''
  };
}

function getOrCreateGame(duelId, duel) {
  if (games.has(duelId)) return games.get(duelId);
  const g = {
    players: new Map(),
    ready: new Set(),
    scores: new Map(duel.participants.map((p) => [p.user.toString(), 0])),
    currentIdx: -1,
    roundAnswered: new Set(),
    questions: duel.questions,
    reversed: duel.reversed,
    duelDoc: duel,
    startedAt: null
  };
  games.set(duelId, g);
  return g;
}

function startRound(io, duelId, game) {
  game.currentIdx += 1;
  game.roundAnswered = new Set();
  if (game.currentIdx >= game.questions.length) {
    return finishGame(io, duelId, game);
  }
  const q = game.questions[game.currentIdx];
  io.to(duelId).emit('live:round', {
    index: game.currentIdx,
    total: game.questions.length,
    question: maskQuestion(q, game.reversed),
    startsInMs: 0
  });
  // Timeout om ingen svarar
  game.roundTimer = setTimeout(() => {
    advanceRound(io, duelId, game, null, null, null);
  }, ROUND_TIMEOUT_MS);
}

function advanceRound(io, duelId, game, winnerId, given, isCorrect) {
  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
    game.roundTimer = null;
  }
  const q = game.questions[game.currentIdx];
  const expected = expectedFor(q, game.reversed);
  io.to(duelId).emit('live:round-result', {
    index: game.currentIdx,
    winnerId: winnerId || null,
    given,
    isCorrect: !!isCorrect,
    expected,
    scores: Array.from(game.scores.entries()).map(([id, s]) => ({ userId: id, score: s }))
  });
  setTimeout(() => startRound(io, duelId, game), BETWEEN_ROUNDS_MS);
}

async function finishGame(io, duelId, game) {
  if (game.finished) return;
  game.finished = true;
  // Skriv tillbaka till Duel-dokumentet så result-sidan kan hämta det
  // som vanligt via REST.
  try {
    const duel = await Duel.findById(duelId);
    if (duel) {
      for (const p of duel.participants) {
        const score = game.scores.get(p.user.toString()) ?? 0;
        p.correct = score;
        p.total = game.questions.length;
        p.durationMs = game.startedAt ? Date.now() - game.startedAt : 0;
        p.status = 'completed';
        p.completedAt = new Date();
      }
      // Live-duell är nu klar och ska inte längre auto-rensas.
      duel.liveExpiresAt = null;
      await duel.save();
    }
  } catch (e) {
    console.error('Live duel finalize error:', e.message);
  }
  io.to(duelId).emit('live:game-over', {
    scores: Array.from(game.scores.entries()).map(([id, s]) => ({ userId: id, score: s })),
    total: game.questions.length
  });
  games.delete(duelId);
}

function registerLiveDuel(io) {
  io.on('connection', (socket) => {
    socket.on('live:join', async ({ duelId }) => {
      if (!duelId) return socket.emit('live:error', 'Saknar duelId');
      try {
        const duel = await Duel.findById(duelId);
        if (!duel || duel.kind !== 'live') {
          return socket.emit('live:error', 'Live-duellen hittades inte');
        }
        const userId = socket.user.id;
        const isParticipant = duel.participants.some((p) => p.user.toString() === userId);
        if (!isParticipant) {
          return socket.emit('live:error', 'Du är inte med i den här duellen');
        }
        const game = getOrCreateGame(duelId, duel);
        if (game.finished) {
          return socket.emit('live:error', 'Duellen är redan klar');
        }
        socket.join(duelId);
        game.players.set(userId, socket.id);
        socket.data.liveDuelId = duelId;

        // Hämta deltagarinfo så lobbyn kan visa avatar/namn
        const populated = await Duel.findById(duelId)
          .populate('participants.user', 'username avatar')
          .lean();
        io.to(duelId).emit('live:lobby', {
          duelId,
          questionCount: game.questions.length,
          participants: populated.participants.map((p) => ({
            userId: p.user._id || p.user,
            username: p.user.username || null,
            avatar: p.user.avatar || null,
            connected: game.players.has((p.user._id || p.user).toString()),
            ready: game.ready.has((p.user._id || p.user).toString())
          }))
        });
      } catch (e) {
        socket.emit('live:error', e.message);
      }
    });

    socket.on('live:ready', () => {
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game || game.finished) return;
      game.ready.add(socket.user.id);
      io.to(duelId).emit('live:lobby-update', {
        ready: Array.from(game.ready)
      });
      // Båda redo → kicka igång
      const allReady =
        game.scores.size === game.ready.size &&
        Array.from(game.scores.keys()).every((id) => game.ready.has(id));
      if (allReady && game.currentIdx === -1) {
        game.startedAt = Date.now();
        io.to(duelId).emit('live:start', { startsInMs: QUESTION_REVEAL_MS });
        setTimeout(() => startRound(io, duelId, game), QUESTION_REVEAL_MS);
      }
    });

    socket.on('live:answer', ({ index, given }) => {
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game || game.finished) return;
      if (index !== game.currentIdx) return; // gammal/försenat svar
      const userId = socket.user.id;
      if (game.roundAnswered.has(userId)) return; // har redan svarat i denna runda
      game.roundAnswered.add(userId);

      const q = game.questions[game.currentIdx];
      const expected = expectedFor(q, game.reversed);
      const isCorrect = answerMatches(given, expected);
      if (isCorrect) {
        // Först rätt vinner rundan
        game.scores.set(userId, (game.scores.get(userId) || 0) + 1);
        advanceRound(io, duelId, game, userId, given, true);
        return;
      }
      // Fel — informera bara den som svarade, vänta tills någon får rätt
      // eller timer löper ut
      socket.emit('live:answer-rejected', { index, given });
      // Om alla deltagare har svarat fel: gå vidare utan vinnare
      if (game.roundAnswered.size === game.players.size) {
        advanceRound(io, duelId, game, null, null, false);
      }
    });

    socket.on('disconnect', () => {
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game) return;
      const userId = socket.user.id;
      game.players.delete(userId);
      game.ready.delete(userId);
      io.to(duelId).emit('live:opponent-left', { userId });
      // Om ingen är kvar, rensa state (men låt Duel-dokumentet vara —
      // TTL-indexet tar det när liveExpiresAt passerar)
      if (game.players.size === 0 && !game.finished) {
        if (game.roundTimer) clearTimeout(game.roundTimer);
        games.delete(duelId);
      }
    });
  });
}

module.exports = { registerLiveDuel };

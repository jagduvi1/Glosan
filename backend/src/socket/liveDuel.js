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

// Mjuk svarsmatchning: trimma + lowercase + slash-varianter ("mycket söt/gullig"
// → "mycket söt" eller "mycket gullig"). Ord för ord — alla kombinationer
// räknades förut ut i förväg, och "a/b a/b a/b …" (2^50 varianter) åt upp
// serverns minne.
function answerMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const words = given.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = expected.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length !== tokens.length) return false;
  return tokens.every((t, i) => t.split('/').map((s) => s.trim()).filter(Boolean).includes(words[i]));
}

// Varje händelse och timer körs skyddat: ett fel (eller ett trasigt meddelande
// från en klient) loggas i stället för att ta ner hela servern för alla.
function safe(name, fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.catch === 'function') out.catch((e) => console.error(`live duel ${name}:`, e.message));
    } catch (e) {
      console.error(`live duel ${name}:`, e.message);
    }
  };
}

// Timers hör till sin match: de rensas när matchen tar slut eller alla går, och
// gör ingenting om matchen hunnit bytas ut (samma duell startad på nytt).
function later(duelId, game, ms, fn) {
  const t = setTimeout(safe('timer', () => {
    game.timers.delete(t);
    if (game.finished || games.get(duelId) !== game) return;
    fn();
  }), ms);
  game.timers.add(t);
  return t;
}

function clearTimers(game) {
  for (const t of game.timers) clearTimeout(t);
  game.timers.clear();
  game.roundTimer = null;
}

const isObjectId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

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
    // En runda är öppen från frågan tills den avgjorts: svar efter det (en
    // andra rätt inom pausen) räknas inte och startar inga fler rundor.
    roundOpen: false,
    startScheduled: false,
    timers: new Set(),
    questions: duel.questions,
    reversed: duel.reversed,
    duelDoc: duel,
    startedAt: null
  };
  games.set(duelId, g);
  return g;
}

function startRound(io, duelId, game) {
  if (game.finished || games.get(duelId) !== game) return;
  game.currentIdx += 1;
  game.roundAnswered = new Set();
  if (game.currentIdx >= game.questions.length) {
    return finishGame(io, duelId, game);
  }
  const q = game.questions[game.currentIdx];
  game.roundOpen = true;
  io.to(duelId).emit('live:round', {
    index: game.currentIdx,
    total: game.questions.length,
    question: maskQuestion(q, game.reversed),
    startsInMs: 0
  });
  // Timeout om ingen svarar
  game.roundTimer = later(duelId, game, ROUND_TIMEOUT_MS, () => {
    advanceRound(io, duelId, game, null, null, null);
  });
}

function advanceRound(io, duelId, game, winnerId, given, isCorrect) {
  // Bara en gång per runda — annars startade ett sent svar en extra runda,
  // och en kvarglömd timer kraschade servern efter sista frågan.
  if (!game.roundOpen) return;
  game.roundOpen = false;
  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
    game.timers.delete(game.roundTimer);
    game.roundTimer = null;
  }
  const q = game.questions[game.currentIdx];
  if (!q) return;
  const expected = expectedFor(q, game.reversed);
  io.to(duelId).emit('live:round-result', {
    index: game.currentIdx,
    winnerId: winnerId || null,
    given,
    isCorrect: !!isCorrect,
    expected,
    scores: Array.from(game.scores.entries()).map(([id, s]) => ({ userId: id, score: s }))
  });
  later(duelId, game, BETWEEN_ROUNDS_MS, () => startRound(io, duelId, game));
}

async function finishGame(io, duelId, game) {
  if (game.finished) return;
  game.finished = true;
  game.roundOpen = false;
  clearTimers(game);
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
  // Bara den här matchen — en ny av samma duell får aldrig raderas härifrån.
  if (games.get(duelId) === game) games.delete(duelId);
}

function registerLiveDuel(io) {
  io.on('connection', (socket) => {
    socket.on('live:join', safe('join', async (payload) => {
      const duelId = payload?.duelId;
      if (!isObjectId(duelId)) return socket.emit('live:error', 'Saknar duelId');
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
        // En avgjord duell spelas inte om (resultatet skulle skrivas över).
        if (duel.participants.every((p) => p.status === 'completed')) {
          return socket.emit('live:error', 'Duellen är redan klar');
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
        console.error('live duel join:', e.message);
        socket.emit('live:error', 'Kunde inte gå med i duellen');
      }
    }));

    socket.on('live:ready', safe('ready', () => {
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game || game.finished) return;
      game.ready.add(socket.user.id);
      io.to(duelId).emit('live:lobby-update', {
        ready: Array.from(game.ready)
      });
      // Båda redo → kicka igång (en gång — ett upprepat "redo" under
      // nedräkningen startade matchen igen).
      const allReady =
        game.scores.size === game.ready.size &&
        Array.from(game.scores.keys()).every((id) => game.ready.has(id));
      if (allReady && game.currentIdx === -1 && !game.startScheduled) {
        game.startScheduled = true;
        game.startedAt = Date.now();
        io.to(duelId).emit('live:start', { startsInMs: QUESTION_REVEAL_MS });
        later(duelId, game, QUESTION_REVEAL_MS, () => startRound(io, duelId, game));
      }
    }));

    socket.on('live:answer', safe('answer', (payload) => {
      const index = payload?.index;
      const given = payload?.given;
      if (!Number.isInteger(index) || typeof given !== 'string' || given.length > 200) return;
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game || game.finished || !game.roundOpen) return; // rundan redan avgjord
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
      // Alla som är kvar har svarat fel (inte "lika många svar som spelare" —
      // den som svarat och sedan gått räknades annars med).
      if ([...game.players.keys()].every((id) => game.roundAnswered.has(id))) {
        advanceRound(io, duelId, game, null, null, false);
      }
    }));

    socket.on('disconnect', safe('disconnect', () => {
      const duelId = socket.data.liveDuelId;
      if (!duelId) return;
      const game = games.get(duelId);
      if (!game) return;
      const userId = socket.user.id;
      // En gammal anslutning som stängs efter att spelaren redan kopplat upp
      // igen (wifi → 4G) får inte ta bort den nya.
      if (game.players.get(userId) !== socket.id) return;
      game.players.delete(userId);
      game.ready.delete(userId);
      io.to(duelId).emit('live:opponent-left', { userId });
      // Om ingen är kvar, rensa state (men låt Duel-dokumentet vara —
      // TTL-indexet tar det när liveExpiresAt passerar). Alla timers följer
      // med, annars fortsatte den gamla matchen bredvid en ny.
      if (game.players.size === 0 && !game.finished) {
        clearTimers(game);
        game.roundOpen = false;
        games.delete(duelId);
      }
    }));
  });
}

module.exports = { registerLiveDuel, answerMatches, _games: games };

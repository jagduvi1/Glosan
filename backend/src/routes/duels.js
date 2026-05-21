const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const Duel = require('../models/Duel');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const Friendship = require('../models/Friendship');
const User = require('../models/User');

const router = express.Router();

router.use(requireAuth);

const DEFAULT_QUESTIONS = 5;
const MAX_QUESTIONS = 20;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Reducerar populerade users till compact JSON som frontend behöver.
function shapeParticipant(p) {
  return {
    user: p.user?._id || p.user,
    username: p.user?.username,
    avatar: p.user?.avatar,
    status: p.status,
    correct: p.correct,
    total: p.total,
    durationMs: p.durationMs,
    completedAt: p.completedAt
  };
}

function shapeDuel(duel, viewerId, options = {}) {
  const { includeQuestions = false } = options;
  const obj = {
    _id: duel._id,
    list: duel.list?._id ? { _id: duel.list._id, title: duel.list.title } : duel.list,
    createdBy: duel.createdBy?._id || duel.createdBy,
    reversed: duel.reversed,
    participants: (duel.participants || []).map(shapeParticipant),
    createdAt: duel.createdAt
  };
  if (includeQuestions) obj.questions = duel.questions;
  // Hjälpfält: din egen status i utmaningen.
  const mine = (duel.participants || []).find((p) => {
    const id = p.user?._id || p.user;
    return id && id.toString() === viewerId;
  });
  obj.myStatus = mine?.status || null;
  obj.allCompleted = (duel.participants || []).every((p) => p.status === 'completed');
  return obj;
}

// POST /api/duels — skapa en utmaning på en lista mot en eller flera kompisar.
// Body: { listId, opponentIds: [string], questionCount? }
router.post('/', async (req, res) => {
  const { listId, opponentIds, questionCount } = req.body;
  if (!mongoose.Types.ObjectId.isValid(listId)) {
    return res.status(400).json({ error: 'Invalid listId' });
  }
  if (!Array.isArray(opponentIds) || opponentIds.length === 0) {
    return res.status(400).json({ error: 'opponentIds måste vara en lista med minst ett ID' });
  }
  const validOpponents = opponentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validOpponents.length === 0) {
    return res.status(400).json({ error: 'Inga giltiga motståndare' });
  }
  const n = Math.min(Math.max(Number(questionCount) || DEFAULT_QUESTIONS, 1), MAX_QUESTIONS);

  try {
    // Listan måste vara läsbar för utmanaren (egen eller delad med mig).
    const list = await GlosList.findOne({
      _id: listId,
      $or: [{ user: req.user.id }, { sharedWith: req.user.id }]
    });
    if (!list) return res.status(404).json({ error: 'List not found' });

    // Alla motståndare måste vara konfirmerade kompisar.
    const friendships = await Friendship.find({
      user: req.user.id,
      friend: { $in: validOpponents }
    }, 'friend').lean();
    const confirmedFriends = new Set(friendships.map((f) => f.friend.toString()));
    const opponents = validOpponents.filter((id) => confirmedFriends.has(id));
    if (opponents.length === 0) {
      return res.status(400).json({ error: 'Du måste vara kompis för att utmana.' });
    }

    // Lottera frågorna en gång. Snapshot:as inline så raderade glosor inte
    // skadar pågående duells.
    const allGlosor = await Glos.find({ list: list._id }).lean();
    if (allGlosor.length === 0) {
      return res.status(400).json({ error: 'Listan har inga glosor — kan inte utmana.' });
    }
    const picked = shuffle(allGlosor).slice(0, Math.min(n, allGlosor.length));
    const questions = picked.map((g) => ({
      glosId: g._id,
      source: g.source,
      target: g.target,
      notes: g.notes || ''
    }));

    const duel = await Duel.create({
      list: list._id,
      createdBy: req.user.id,
      questions,
      reversed: list.quizReversed ?? true,
      participants: [
        { user: req.user.id, status: 'pending' },
        ...opponents.map((id) => ({ user: id, status: 'pending' }))
      ]
    });
    const populated = await Duel.findById(duel._id)
      .populate('participants.user', 'username avatar')
      .populate('list', 'title');
    res.status(201).json({ duel: shapeDuel(populated, req.user.id) });
  } catch (err) {
    console.error('Duel create error:', err);
    res.status(500).json({ error: 'Failed to create duel' });
  }
});

// GET /api/duels — alla duells jag är med i, sorterade på senast skapade.
router.get('/', async (req, res) => {
  try {
    const duels = await Duel.find({ 'participants.user': req.user.id })
      .populate('participants.user', 'username avatar')
      .populate('list', 'title')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ duels: duels.map((d) => shapeDuel(d, req.user.id)) });
  } catch (err) {
    console.error('Duel list error:', err);
    res.status(500).json({ error: 'Failed to fetch duels' });
  }
});

// GET /api/duels/:id — detaljer + frågor om jag inte spelat än, annars bara
// metadata + resultat. Tillgängligt bara för deltagare.
router.get('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const duel = await Duel.findById(req.params.id)
      .populate('participants.user', 'username avatar')
      .populate('list', 'title');
    if (!duel) return res.status(404).json({ error: 'Duel not found' });
    const mine = duel.participants.find((p) => {
      const id = p.user?._id || p.user;
      return id && id.toString() === req.user.id;
    });
    if (!mine) return res.status(404).json({ error: 'Duel not found' });
    // Inkludera frågorna om jag inte är klar än (för att kunna spela) eller
    // när alla är klara (för att se vilka frågor det handlade om i resultatet).
    const allCompleted = duel.participants.every((p) => p.status === 'completed');
    const includeQuestions = mine.status === 'pending' || allCompleted;
    res.json({ duel: shapeDuel(duel, req.user.id, { includeQuestions }) });
  } catch (err) {
    console.error('Duel get error:', err);
    res.status(500).json({ error: 'Failed to fetch duel' });
  }
});

// POST /api/duels/:id/submit — body { correct, total, durationMs }. Markerar
// min runda klar. Klienten räknar correct/total själv mot questions; vi
// validerar bara att total matchar questions.length.
router.post('/:id/submit', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  const durationMs = Number(req.body.durationMs);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({ error: 'Ogiltigt resultat' });
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return res.status(400).json({ error: 'Ogiltig duration' });
  }
  try {
    const duel = await Duel.findById(req.params.id);
    if (!duel) return res.status(404).json({ error: 'Duel not found' });
    if (total !== duel.questions.length) {
      return res.status(400).json({ error: 'total matchar inte frågornas antal' });
    }
    const mine = duel.participants.find((p) => p.user.toString() === req.user.id);
    if (!mine) return res.status(404).json({ error: 'Duel not found' });
    if (mine.status === 'completed') {
      return res.status(400).json({ error: 'Du har redan spelat den här utmaningen.' });
    }
    mine.status = 'completed';
    mine.correct = correct;
    mine.total = total;
    mine.durationMs = durationMs;
    mine.completedAt = new Date();
    await duel.save();
    const populated = await Duel.findById(duel._id)
      .populate('participants.user', 'username avatar')
      .populate('list', 'title');
    res.json({ duel: shapeDuel(populated, req.user.id, { includeQuestions: true }) });
  } catch (err) {
    console.error('Duel submit error:', err);
    res.status(500).json({ error: 'Failed to submit duel' });
  }
});

// DELETE /api/duels/:id — bara skaparen får ta bort, och bara om alla väntar.
router.delete('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const duel = await Duel.findById(req.params.id);
    if (!duel) return res.status(404).json({ error: 'Duel not found' });
    if (duel.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Bara du som skapade utmaningen får ta bort.' });
    }
    await duel.deleteOne();
    res.json({ message: 'Duel deleted' });
  } catch (err) {
    console.error('Duel delete error:', err);
    res.status(500).json({ error: 'Failed to delete duel' });
  }
});

module.exports = router;

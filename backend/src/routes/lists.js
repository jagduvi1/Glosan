const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedList } = require('../middleware/ownership');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const lists = await GlosList.find({ user: req.user.id }).sort({ updatedAt: -1 });
    res.json({ lists });
  } catch (error) {
    console.error('List index error:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, sourceLang, targetLang } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const list = await GlosList.create({
      user: req.user.id,
      title,
      description,
      sourceLang,
      targetLang
    });
    res.status(201).json({ list });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('List create error:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

router.get('/:id', loadOwnedList(), async (req, res) => {
  try {
    const glosor = await Glos.find({ list: req.list._id }).sort({ createdAt: 1 });
    res.json({ list: req.list, glosor });
  } catch (error) {
    console.error('List get error:', error);
    res.status(500).json({ error: 'Failed to fetch list' });
  }
});

router.put('/:id', loadOwnedList(), async (req, res) => {
  try {
    const { title, description, sourceLang, targetLang, quizReversed } = req.body;
    if (title !== undefined) req.list.title = title;
    if (description !== undefined) req.list.description = description;
    if (sourceLang !== undefined) req.list.sourceLang = sourceLang;
    if (targetLang !== undefined) req.list.targetLang = targetLang;
    if (typeof quizReversed === 'boolean') req.list.quizReversed = quizReversed;
    await req.list.save();

    res.json({ list: req.list });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('List update error:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

// POST /api/lists/:id/score — submit a quiz result; updates bestScore only if
// the new correct/total ratio is strictly higher than the existing record.
router.post('/:id/score', loadOwnedList(), async (req, res) => {
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({ error: 'correct and total must be valid numbers with 0 <= correct <= total and total > 0' });
  }
  try {
    const newRatio = correct / total;
    const oldTotal = req.list.bestScore?.total || 0;
    const oldRatio = oldTotal > 0 ? req.list.bestScore.correct / oldTotal : 0;
    const wasNewBest = newRatio > oldRatio;

    if (wasNewBest) {
      req.list.bestScore = { correct, total, achievedAt: new Date() };
      await req.list.save();
    }

    res.json({ list: req.list, wasNewBest });
  } catch (error) {
    console.error('List score submit error:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

// POST /api/lists/:id/swap-direction — flip the list's source/target languages,
// swap the source/target on every glos in the list, and flip quizReversed so
// the quiz experience stays identical. Useful when a list was created with the
// "wrong" orientation and the user wants the add-glos form swapped.
router.post('/:id/swap-direction', loadOwnedList(), async (req, res) => {
  try {
    const { sourceLang, targetLang } = req.list;
    req.list.sourceLang = targetLang;
    req.list.targetLang = sourceLang;
    req.list.quizReversed = !req.list.quizReversed;
    await req.list.save();

    const glosor = await Glos.find({ list: req.list._id }, '_id source target').lean();
    if (glosor.length > 0) {
      const ops = glosor.map((g) => ({
        updateOne: {
          filter: { _id: g._id },
          update: { $set: { source: g.target, target: g.source } }
        }
      }));
      await Glos.bulkWrite(ops);
    }

    res.json({ list: req.list, glosorSwapped: glosor.length });
  } catch (error) {
    console.error('List swap-direction error:', error);
    res.status(500).json({ error: 'Failed to swap direction' });
  }
});

router.delete('/:id', loadOwnedList(), async (req, res) => {
  try {
    await Glos.deleteMany({ list: req.list._id });
    await req.list.deleteOne();
    res.json({ message: 'List deleted' });
  } catch (error) {
    console.error('List delete error:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

module.exports = router;

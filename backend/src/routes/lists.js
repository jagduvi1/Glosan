const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');

const router = express.Router();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

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

router.get('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid list id' });
  }
  try {
    const list = await GlosList.findOne({ _id: req.params.id, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });
    const glosor = await Glos.find({ list: list._id }).sort({ createdAt: 1 });
    res.json({ list, glosor });
  } catch (error) {
    console.error('List get error:', error);
    res.status(500).json({ error: 'Failed to fetch list' });
  }
});

router.put('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid list id' });
  }
  try {
    const list = await GlosList.findOne({ _id: req.params.id, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const { title, description, sourceLang, targetLang } = req.body;
    if (title !== undefined) list.title = title;
    if (description !== undefined) list.description = description;
    if (sourceLang !== undefined) list.sourceLang = sourceLang;
    if (targetLang !== undefined) list.targetLang = targetLang;
    await list.save();

    res.json({ list });
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
router.post('/:id/score', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid list id' });
  }
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({ error: 'correct and total must be valid numbers with 0 <= correct <= total and total > 0' });
  }
  try {
    const list = await GlosList.findOne({ _id: req.params.id, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const newRatio = correct / total;
    const oldTotal = list.bestScore?.total || 0;
    const oldRatio = oldTotal > 0 ? list.bestScore.correct / oldTotal : 0;
    const wasNewBest = newRatio > oldRatio;

    if (wasNewBest) {
      list.bestScore = { correct, total, achievedAt: new Date() };
      await list.save();
    }

    res.json({ list, wasNewBest });
  } catch (error) {
    console.error('List score submit error:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid list id' });
  }
  try {
    const list = await GlosList.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });
    await Glos.deleteMany({ list: list._id });
    res.json({ message: 'List deleted' });
  } catch (error) {
    console.error('List delete error:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

module.exports = router;

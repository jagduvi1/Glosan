const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');

const router = express.Router();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

router.use(requireAuth);

// Load a glos by id and verify the requesting user owns the parent list.
async function loadOwnedGlos(req, res) {
  if (!isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid glos id' });
    return null;
  }
  const glos = await Glos.findById(req.params.id).populate('list', 'user');
  if (!glos) {
    res.status(404).json({ error: 'Glos not found' });
    return null;
  }
  if (!glos.list || glos.list.user.toString() !== req.user.id) {
    res.status(404).json({ error: 'Glos not found' });
    return null;
  }
  return glos;
}

router.post('/lists/:listId/glosor', async (req, res) => {
  if (!isValidObjectId(req.params.listId)) {
    return res.status(400).json({ error: 'Invalid list id' });
  }
  try {
    const list = await GlosList.findOne({ _id: req.params.listId, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const { source, target, notes, exampleSentence } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'source and target are required' });
    }

    const glos = await Glos.create({
      list: list._id,
      source,
      target,
      notes: notes || '',
      exampleSentence: exampleSentence || ''
    });
    res.status(201).json({ glos });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Glos create error:', error);
    res.status(500).json({ error: 'Failed to create glos' });
  }
});

router.put('/glosor/:id', async (req, res) => {
  try {
    const glos = await loadOwnedGlos(req, res);
    if (!glos) return;

    const { source, target, notes, exampleSentence, stats } = req.body;
    if (source !== undefined) glos.source = source;
    if (target !== undefined) glos.target = target;
    if (notes !== undefined) glos.notes = notes;
    if (exampleSentence !== undefined) glos.exampleSentence = exampleSentence;

    if (stats && typeof stats === 'object') {
      if (typeof stats.correct === 'number') glos.stats.correct = stats.correct;
      if (typeof stats.wrong === 'number') glos.stats.wrong = stats.wrong;
      glos.stats.lastReviewedAt = new Date();
    }

    await glos.save();
    res.json({ glos });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Glos update error:', error);
    res.status(500).json({ error: 'Failed to update glos' });
  }
});

router.delete('/glosor/:id', async (req, res) => {
  try {
    const glos = await loadOwnedGlos(req, res);
    if (!glos) return;
    await glos.deleteOne();
    res.json({ message: 'Glos deleted' });
  } catch (error) {
    console.error('Glos delete error:', error);
    res.status(500).json({ error: 'Failed to delete glos' });
  }
});

module.exports = router;
